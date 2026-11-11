package gemini

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

const narrativeJSON = `{"title":"Draft inspeksi sesi S-15","summary":"Satu temuan.","details":[{"finding_ref":"F-105","observation":"Kepala tanpa helm.","follow_up":"Tindak lanjut belum dicatat."}],"missing_information":[]}`

func envelope(text string) string {
	b, _ := json.Marshal(map[string]any{
		"status": "completed",
		"steps": []any{
			map[string]any{"type": "user_input", "content": []any{map[string]any{"type": "text", "text": "ignored"}}},
			map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "text", "text": text}}},
		},
	})
	return string(b)
}

func newClient(url string) *Client {
	return &Client{BaseURL: url, APIKey: "k", ModelName: "m", APIVersion: "v1", Timeout: 10 * time.Second, MaxAttempts: 2, HC: http.DefaultClient}
}

func TestGenerateExtractsAndRetries(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/interactions" || r.Header.Get("x-goog-api-key") != "k" {
			t.Errorf("bad request %s key=%q", r.URL.Path, r.Header.Get("x-goog-api-key"))
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["store"] != false || body["system_instruction"] != SystemPrompt {
			t.Errorf("payload missing store:false or system prompt")
		}
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte(envelope(narrativeJSON)))
	}))
	defer srv.Close()

	n, err := newClient(srv.URL).Generate(context.Background(), []byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || n.Details[0].FindingRef != "F-105" {
		t.Fatalf("calls=%d narrative=%+v", calls.Load(), n)
	}
}

func TestGenerateNoRetryOn400(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	_, err := newClient(srv.URL).Generate(context.Background(), []byte(`{}`))
	var ue *UnavailableError
	if !errors.As(err, &ue) || calls.Load() != 1 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
}

func TestValidate(t *testing.T) {
	ok := func() *Narrative {
		var n Narrative
		json.Unmarshal([]byte(narrativeJSON), &n)
		return &n
	}
	if err := Validate(ok(), []string{"F-105"}); err != nil {
		t.Fatalf("valid narrative rejected: %v", err)
	}
	cases := map[string]func(n *Narrative) []string{
		"missing ref":  func(n *Narrative) []string { return []string{"F-105", "F-106"} },
		"invented ref": func(n *Narrative) []string { n.Details[0].FindingRef = "F-999"; return []string{"F-105"} },
		"duplicate": func(n *Narrative) []string {
			n.Details = append(n.Details, n.Details[0])
			return []string{"F-105"}
		},
		"html": func(n *Narrative) []string { n.Summary = "<script>x</script>"; return []string{"F-105"} },
	}
	for name, mutate := range cases {
		n := ok()
		refs := mutate(n)
		var ie *InvalidOutputError
		if err := Validate(n, refs); !errors.As(err, &ie) {
			t.Errorf("%s: want InvalidOutputError, got %v", name, err)
		}
	}
}
