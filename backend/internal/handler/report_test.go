package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"k3/backend/internal/gemini"
)

// fakeGemini returns one detail per finding_ref it receives and records inputs.
type fakeGemini struct {
	mu     sync.Mutex
	calls  int
	inputs []string
}

func (f *fakeGemini) Model() string { return "fake-model" }
func (f *fakeGemini) Generate(_ context.Context, input []byte) (*gemini.Narrative, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.inputs = append(f.inputs, string(input))
	var p struct {
		Findings []struct {
			FindingRef string `json:"finding_ref"`
		} `json:"findings"`
	}
	json.Unmarshal(input, &p)
	n := &gemini.Narrative{Title: "Draft inspeksi", Summary: "Ringkasan.", MissingInformation: []string{}}
	for _, x := range p.Findings {
		n.Details = append(n.Details, gemini.Detail{FindingRef: x.FindingRef, Observation: "Indikasi tanpa helm.", FollowUp: "Tindak lanjut belum dicatat."})
	}
	return n, nil
}

func num(m map[string]any, k string) int64 { v, _ := m[k].(float64); return int64(v) }

func TestReportFlow(t *testing.T) {
	gem := &fakeGemini{}
	e := newEnv(t, gem)
	c := e.c
	e.ai.mu.Lock()
	e.ai.ready = true
	e.ai.mu.Unlock()

	st, b := c.do("POST", "/auth/login", map[string]string{"username": "petugas", "password": "correct-password"}, nil)
	expect(t, "login", st, 200, b)
	c.csrf = data(b)["csrf_token"].(string)
	_, b = c.do("POST", "/projects", map[string]string{"name": "Gedung A"}, nil)
	pid := num(data(b), "id")
	_, b = c.do("POST", fmt.Sprintf("/projects/%d/zones", pid), map[string]string{"name": "Lantai 2"}, nil)
	zid := num(data(b), "id")
	st, b = c.do("POST", "/monitoring/sessions", map[string]any{"project_id": pid, "zone_id": zid, "source": "browser_webcam"}, nil)
	expect(t, "start", st, 201, b)
	sid := num(data(b), "id")

	frame := testJPEG(t, 120)
	start := time.Now()
	var fid int64
	for seq := 1; seq <= 2; seq++ {
		time.Sleep(20 * time.Millisecond)
		st, b = c.do("POST", fmt.Sprintf("/monitoring/sessions/%d/frames", sid), frame, map[string]string{
			"X-Frame-Sequence": fmt.Sprint(seq), "X-Captured-At": time.Now().UTC().Format(time.RFC3339Nano),
			"X-Sample-Elapsed-Ms": fmt.Sprint(time.Since(start).Milliseconds()),
		})
		expect(t, "frame", st, 200, b)
		if ev := data(b)["events"].([]any); len(ev) == 1 {
			fid = num(ev[0].(map[string]any), "finding_id")
		}
	}
	if fid == 0 {
		t.Fatal("no finding created")
	}
	fpath := fmt.Sprintf("/findings/%d", fid)

	// Review rules (§5.5).
	st, b = c.do("PATCH", fpath, map[string]any{"version": 1, "verification_status": "rejected"}, nil)
	expect(t, "reject without notes", st, 422, b)
	st, b = c.do("PATCH", fpath, map[string]any{"version": 1, "action_status": "in_progress"}, nil)
	if st != 422 || code(b) != "ACTION_REQUIRES_CONFIRMED" {
		t.Fatalf("action on pending: %d %v", st, b)
	}
	st, b = c.do("PATCH", fpath, map[string]any{"version": 1, "verification_status": "confirmed",
		"notes": "Kepala tanpa helm, hubungi 0812-3456-7890"}, nil)
	expect(t, "confirm", st, 200, b)
	if data(b)["verified_by"] == nil || num(data(b), "version") != 2 {
		t.Fatalf("confirm did not record verifier/version: %v", b)
	}
	st, b = c.do("PATCH", fpath, map[string]any{"version": 2, "action_status": "completed"}, nil)
	expect(t, "completed without notes", st, 422, b)

	// Report needs a closed session.
	k1, k2, k3 := "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"
	st, b = c.do("POST", "/reports/generate", map[string]any{"session_id": sid, "request_key": k1}, nil)
	if st != 409 || code(b) != "SESSION_STILL_ACTIVE" {
		t.Fatalf("generate on active session: %d %v", st, b)
	}
	st, b = c.do("POST", fmt.Sprintf("/monitoring/sessions/%d/stop", sid), map[string]string{"reason": "user_stop"}, nil)
	expect(t, "stop", st, 200, b)

	st, b = c.do("POST", "/reports/generate", map[string]any{"session_id": sid, "request_key": k1}, nil)
	expect(t, "generate", st, 201, b)
	rep := data(b)
	rid := num(rep, "id")
	if rep["generated_by"] != "gemini" || rep["is_stale"] != false || !strings.Contains(rep["content"].(string), fmt.Sprintf("[F-%d]", fid)) {
		t.Fatalf("bad draft: %v", rep)
	}
	if strings.Contains(gem.inputs[0], "0812") || strings.Contains(gem.inputs[0], "track") {
		t.Fatalf("payload leaked phone or track data: %s", gem.inputs[0])
	}
	if !strings.Contains(gem.inputs[0], `"detection_method":"deteksi_otomatis_model_lalu_diverifikasi_petugas"`) {
		t.Fatalf("payload must say findings came from automatic detection: %s", gem.inputs[0])
	}
	if rep["prompt_version"] != "k3-report-v2" {
		t.Fatalf("prompt_version: %v", rep["prompt_version"])
	}
	st, b = c.do("POST", "/reports/generate", map[string]any{"session_id": sid, "request_key": k1}, nil)
	if st != 201 || num(data(b), "id") != rid || gem.calls != 1 {
		t.Fatalf("replay must return same report without Gemini call: %d %v calls=%d", st, b, gem.calls)
	}
	st, b = c.do("POST", "/reports/generate", map[string]any{"session_id": sid, "request_key": k2}, nil)
	if st != 409 || code(b) != "REPORT_EXISTS" {
		t.Fatalf("second report: %d %v", st, b)
	}
	st, b = c.do("POST", "/reports", map[string]any{"session_id": sid, "use_template": true, "content": "x"}, nil)
	expect(t, "template+content", st, 422, b)

	// Editing a source finding makes the draft stale; approval must refuse it.
	st, b = c.do("PATCH", fpath, map[string]any{"version": 2, "notes": "Kepala terlihat jelas tanpa helm."}, nil)
	expect(t, "edit notes", st, 200, b)
	rpath := fmt.Sprintf("/reports/%d", rid)
	_, b = c.do("GET", rpath, nil, nil)
	if data(b)["is_stale"] != true {
		t.Fatalf("draft should be stale: %v", b)
	}
	st, b = c.do("POST", rpath+"/approve", map[string]any{"version": 1, "review_acknowledged": true}, nil)
	if st != 409 || code(b) != "STALE_REPORT" {
		t.Fatalf("approve stale: %d %v", st, b)
	}
	st, b = c.do("POST", rpath+"/regenerate", map[string]any{"version": 1, "request_key": k3}, nil)
	expect(t, "regenerate", st, 200, b)
	if data(b)["is_stale"] != false || num(data(b), "version") != 2 {
		t.Fatalf("regenerated draft: %v", b)
	}
	st, b = c.do("POST", "/reports/generate", map[string]any{"session_id": sid, "request_key": k1}, nil)
	if st != 409 || code(b) != "REQUEST_KEY_EXPIRED" {
		t.Fatalf("old key after regenerate: %d %v", st, b)
	}

	st, b = c.do("POST", rpath+"/approve", map[string]any{"version": 2, "review_acknowledged": false}, nil)
	expect(t, "approve without ack", st, 422, b)
	st, b = c.do("POST", rpath+"/approve", map[string]any{"version": 2, "review_acknowledged": true}, nil)
	if st != 200 || data(b)["status"] != "approved" || data(b)["approved_by"] == nil {
		t.Fatalf("approve: %d %v", st, b)
	}
	st, b = c.do("POST", rpath+"/approve", map[string]any{"version": 2, "review_acknowledged": true}, nil)
	expect(t, "approve again", st, 200, b)

	// Approved report and its sources are locked (BR-07, BR-08).
	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{"PATCH", fpath, map[string]any{"version": 3, "notes": "ubah"}},
		{"PATCH", rpath, map[string]any{"version": 3, "content": "ubah"}},
		{"DELETE", rpath + "?version=3", nil},
	} {
		st, b = c.do(tc.method, tc.path, tc.body, nil)
		if st != 409 || code(b) != "REPORT_LOCKED" {
			t.Fatalf("%s %s on approved: %d %v", tc.method, tc.path, st, b)
		}
	}

	_, b = c.do("GET", "/findings?verification_status=confirmed", nil, nil)
	if num(b["meta"].(map[string]any), "total") != 1 {
		t.Fatalf("finding list: %v", b)
	}
	st, b = c.do("GET", "/dashboard/summary?from=2000-01-01T00:00:00Z", nil, nil)
	expect(t, "dashboard", st, 200, b)
	d := data(b)
	if num(d, "sessions") != 1 || num(d, "findings_confirmed") != 1 || num(d, "findings_pending") != 0 || num(d, "confirmed_actions_open") != 1 {
		t.Fatalf("dashboard counts: %v", d)
	}
	st, b = c.do("GET", "/dashboard/trends?from=2000-01-01T00:00:00Z", nil, nil)
	expect(t, "trends", st, 200, b)
	today := time.Now().In(e.api.Cfg.DisplayTimezone).Format("2006-01-02")
	if tr := b["data"].([]any); len(tr) != 1 || tr[0].(map[string]any)["date"] != today || num(tr[0].(map[string]any), "count_confirmed") != 1 {
		t.Fatalf("trends: %v (want %s)", b, today)
	}
	st, b = c.do("GET", "/dashboard/zones", nil, nil)
	expect(t, "zones", st, 200, b)
	if zs := b["data"].([]any); len(zs) != 1 || zs[0].(map[string]any)["zone_name"] != "Lantai 2" || num(zs[0].(map[string]any), "count_confirmed") != 1 {
		t.Fatalf("zones: %v", b)
	}
	_, b = c.do("GET", "/dashboard/zones?mode=simulated", nil, nil)
	if len(b["data"].([]any)) != 0 {
		t.Fatalf("simulated must not include real findings: %v", b)
	}
	st, b = c.do("GET", "/dashboard/summary?from=2000-01-01", nil, nil)
	expect(t, "from without offset", st, 400, b)

	st, b = c.do("POST", "/findings", map[string]any{}, nil)
	if st != 403 || code(b) != "MANUAL_FALLBACK_DISABLED" {
		t.Fatalf("manual finding while disabled: %d %v", st, b)
	}
}

func TestGenerateWithoutGemini(t *testing.T) {
	e := newEnv(t, nil)
	_, b := e.c.do("POST", "/auth/login", map[string]string{"username": "petugas", "password": "correct-password"}, nil)
	e.c.csrf = data(b)["csrf_token"].(string)
	st, b := e.c.do("POST", "/reports/generate", map[string]any{"session_id": 1, "request_key": "11111111-1111-4111-8111-111111111111"}, nil)
	if st != 503 || code(b) != "GEMINI_UNAVAILABLE" {
		t.Fatalf("generate without Gemini: %d %v", st, b)
	}
}
