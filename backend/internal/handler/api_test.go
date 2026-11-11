package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"k3/backend/internal/aiclient"
	"k3/backend/internal/config"
	"k3/backend/internal/gemini"
	"k3/backend/internal/repository/sqlite"
	"k3/backend/internal/service"
	"k3/backend/internal/storage"
)

type fakeAI struct {
	mu      sync.Mutex
	ready   bool
	calls   int
	persons []aiclient.Person
}

func (f *fakeAI) ModelInfo(context.Context) (*aiclient.ModelInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return &aiclient.ModelInfo{Ready: f.ready, Mode: "real", ModelVersion: "test-v1",
		SupportedViolations: []string{"NO_HELMET", "NO_VEST"}, EngineInstanceID: "eng-1"}, nil
}
func (f *fakeAI) StartSession(context.Context, string, string) error { return nil }
func (f *fakeAI) StopSession(context.Context, string) error          { return nil }
func (f *fakeAI) Infer(_ context.Context, r aiclient.InferRequest) (*aiclient.InferResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	c, _ := jpeg.DecodeConfig(bytes.NewReader(r.JPEG))
	return &aiclient.InferResult{SessionKey: r.SessionKey, EngineInstanceID: "eng-1", FrameSequence: r.FrameSequence,
		Mode: "real", ModelVersion: "test-v1", Width: c.Width, Height: c.Height, Persons: f.persons}, nil
}

func testJPEG(t *testing.T, shade uint8) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 64, 48))
	for i := range img.Pix {
		img.Pix[i] = shade
	}
	img.Set(0, 0, color.RGBA{255, 0, 0, 255})
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func migrate(t *testing.T, store *sqlite.Store) {
	sqlBytes, err := os.ReadFile("../../migrations/001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	up, _, _ := strings.Cut(string(sqlBytes), "-- migrate:down")
	if _, err := store.DB.Exec(up); err != nil {
		t.Fatal(err)
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if _, err := store.DB.Exec(`INSERT INTO users (username, password_hash, display_name, created_at) VALUES ('petugas', ?, 'Anisa', ?)`,
		string(hash), sqlite.Now()); err != nil {
		t.Fatal(err)
	}
}

type client struct {
	t    *testing.T
	base string
	hc   *http.Client
	csrf string
}

func (c *client) do(method, path string, body any, hdr map[string]string) (int, map[string]any) {
	c.t.Helper()
	var r io.Reader
	ctype := "application/json"
	switch b := body.(type) {
	case nil:
	case []byte:
		r, ctype = bytes.NewReader(b), "image/jpeg"
	default:
		data, _ := json.Marshal(b)
		r = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, c.base+path, r)
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("Origin", "http://test")
	if c.csrf != "" {
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	json.Unmarshal(raw, &out)
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "image/") {
		out = map[string]any{"bytes": raw}
	}
	return resp.StatusCode, out
}

func code(body map[string]any) string {
	e, _ := body["error"].(map[string]any)
	s, _ := e["code"].(string)
	return s
}

func data(body map[string]any) map[string]any { d, _ := body["data"].(map[string]any); return d }

func expect(t *testing.T, step string, got, want int, body map[string]any) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: status %d want %d, body %v", step, got, want, body)
	}
}

type env struct {
	c   *client
	db  *sql.DB
	ai  *fakeAI
	api *API
}

// newEnv starts the full API over HTTP with SQLite in a temp dir and fake AI/Gemini.
func newEnv(t *testing.T, gen gemini.Generator) *env {
	dir := t.TempDir()
	db, err := sqlite.Open(filepath.Join(dir, "k3.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	store := &sqlite.Store{DB: db}
	migrate(t, store)
	ev, _ := storage.NewEvidence(filepath.Join(dir, "evidence"))

	jakarta, _ := time.LoadLocation("Asia/Jakarta")
	cfg := &config.Config{
		AllowedOrigins: []string{"http://test"}, AuthCookieName: "k3_session", AuthTTL: time.Hour,
		// High FPS keeps the anti-flood gap tiny so the test needs no sleeps.
		FrameTargetFPS: 100, ConfirmHits: 2, ConfirmMaxFrames: 3, ConfirmWindow: 2 * time.Second,
		TrackTimeout: 5 * time.Second, SessionIdleTimeout: time.Minute, FrameMaxBytes: 1 << 20, FrameMaxPixels: 1_000_000,
		AITimeout: time.Second, FrameTotalDeadline: 2 * time.Second, AIMode: "real",
		ReportPromptVersion: "k3-report-v2", DisplayTimezone: jakarta,
	}
	conf, box := 0.9, [4]float64{0.3, 0.1, 0.4, 0.3}
	ai := &fakeAI{persons: []aiclient.Person{{TrackID: 17, Confidence: 0.9, BBox: [4]float64{0.2, 0.1, 0.6, 0.9},
		PPE: []aiclient.PPE{{Type: "NO_HELMET", State: "positive", Confidence: &conf, BBox: &box}}}}}
	mon := &service.Monitoring{Store: store, AI: ai, Evidence: ev, Cfg: cfg}
	api := &API{Cfg: cfg, DB: db, Store: store, AI: ai, Monitoring: mon, Master: &service.Master{Store: store},
		Auth:     &service.Auth{Store: store, TTL: time.Hour, Limiter: service.NewLoginLimiter(5, time.Minute), OnLogout: mon.StopForUser},
		Findings: &service.Findings{Store: store, Evidence: ev, Cfg: cfg},
		Reports:  &service.Reports{Store: store, Gemini: gen, Cfg: cfg}}

	srv := httptest.NewUnstartedServer(nil)
	cfg.AllowedHosts = []string{srv.Listener.Addr().String()}
	srv.Config.Handler = api.Routes()
	srv.Start()
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	return &env{c: &client{t: t, base: srv.URL + "/api/v1", hc: &http.Client{Jar: jar}}, db: db, ai: ai, api: api}
}

func TestMonitoringFlow(t *testing.T) {
	e := newEnv(t, nil)
	c, db, ai := e.c, e.db, e.ai

	st, b := c.do("POST", "/auth/login", map[string]string{"username": "petugas", "password": "wrong"}, nil)
	expect(t, "bad login", st, 401, b)
	st, b = c.do("POST", "/auth/login", map[string]string{"username": "petugas", "password": "correct-password"}, nil)
	expect(t, "login", st, 200, b)
	csrf := data(b)["csrf_token"].(string)

	st, b = c.do("POST", "/projects", map[string]string{"name": "Gedung A"}, nil)
	if st != 403 || code(b) != "CSRF_INVALID" {
		t.Fatalf("missing CSRF: %d %v", st, b)
	}
	c.csrf = csrf

	st, b = c.do("POST", "/projects", map[string]string{"name": "Gedung A", "location": "Malang"}, nil)
	expect(t, "create project", st, 201, b)
	pid := int64(data(b)["id"].(float64))
	st, b = c.do("PATCH", fmt.Sprintf("/projects/%d", pid), map[string]any{"version": 1, "bogus": true}, nil)
	expect(t, "unknown field", st, 400, b)
	st, b = c.do("PATCH", fmt.Sprintf("/projects/%d", pid), map[string]any{"version": 9, "name": "B"}, nil)
	if st != 409 || code(b) != "VERSION_CONFLICT" {
		t.Fatalf("version conflict: %d %v", st, b)
	}
	st, b = c.do("POST", fmt.Sprintf("/projects/%d/zones", pid), map[string]string{"name": "Lantai 2"}, nil)
	expect(t, "create zone", st, 201, b)
	zid := int64(data(b)["id"].(float64))
	st, b = c.do("POST", fmt.Sprintf("/projects/%d/zones", pid), map[string]string{"name": "Lantai 2"}, nil)
	if st != 409 || code(b) != "DUPLICATE_NAME" {
		t.Fatalf("duplicate zone: %d %v", st, b)
	}

	start := map[string]any{"project_id": pid, "zone_id": zid, "source": "browser_webcam"}
	st, b = c.do("POST", "/monitoring/sessions", start, nil)
	if st != 503 || code(b) != "MODEL_NOT_READY" {
		t.Fatalf("model not ready: %d %v", st, b)
	}
	ai.mu.Lock()
	ai.ready = true
	ai.mu.Unlock()
	st, b = c.do("POST", "/monitoring/sessions", start, nil)
	expect(t, "start session", st, 201, b)
	sid := int64(data(b)["id"].(float64))
	st, b = c.do("POST", "/monitoring/sessions", start, nil)
	if st != 409 || code(b) != "CAMERA_BUSY" {
		t.Fatalf("second session: %d %v", st, b)
	}

	frame := testJPEG(t, 120)
	startAt := time.Now()
	send := func(seq int, img []byte) (int, map[string]any) {
		time.Sleep(20 * time.Millisecond)
		return c.do("POST", fmt.Sprintf("/monitoring/sessions/%d/frames", sid), img, map[string]string{
			"X-Frame-Sequence":    fmt.Sprint(seq),
			"X-Captured-At":       time.Now().UTC().Format(time.RFC3339Nano),
			"X-Sample-Elapsed-Ms": fmt.Sprint(time.Since(startAt).Milliseconds()),
		})
	}
	st, b = send(1, frame)
	expect(t, "frame 1", st, 200, b)
	if n := len(data(b)["events"].([]any)); n != 0 {
		t.Fatalf("frame 1 events = %d, want 0", n)
	}
	st, b = send(2, frame)
	expect(t, "frame 2", st, 200, b)
	events := data(b)["events"].([]any)
	if len(events) != 1 {
		t.Fatalf("frame 2 events = %v, want 1", events)
	}
	evURL := events[0].(map[string]any)["evidence_url"].(string)
	if tk := data(b)["tracks"].([]any)[0].(map[string]any)["track_key"]; tk != "17:1" {
		t.Fatalf("track_key = %v", tk)
	}

	st, b = send(2, frame) // retry: cached, no new AI call
	expect(t, "retry", st, 200, b)
	if len(data(b)["events"].([]any)) != 1 || ai.calls != 2 {
		t.Fatalf("retry must return cache without inference: calls=%d", ai.calls)
	}
	st, b = send(2, testJPEG(t, 30))
	if st != 409 || code(b) != "FRAME_SEQUENCE_CONFLICT" {
		t.Fatalf("seq conflict: %d %v", st, b)
	}
	st, b = send(3, frame) // same episode: suppressed
	expect(t, "frame 3", st, 200, b)
	if n := len(data(b)["events"].([]any)); n != 0 {
		t.Fatalf("frame 3 events = %d, want 0 (dedupe)", n)
	}

	st, b = c.do("GET", strings.TrimPrefix(evURL, "/api/v1"), nil, nil)
	expect(t, "evidence", st, 200, b)
	if sha256.Sum256(b["bytes"].([]byte)) != sha256.Sum256(frame) {
		t.Fatal("evidence bytes differ from trigger frame")
	}
	var nFindings int
	db.QueryRow(`SELECT count(*) FROM findings WHERE verification_status = 'pending'`).Scan(&nFindings)
	if nFindings != 1 {
		t.Fatalf("findings = %d, want 1", nFindings)
	}

	st, b = c.do("PATCH", fmt.Sprintf("/zones/%d", zid), map[string]any{"version": 1, "status": "archived"}, nil)
	if st != 409 || code(b) != "SESSION_ACTIVE" {
		t.Fatalf("archive during session: %d %v", st, b)
	}

	stop := fmt.Sprintf("/monitoring/sessions/%d/stop", sid)
	st, b = c.do("POST", stop, map[string]string{"reason": "user_stop"}, nil)
	if st != 200 || data(b)["status"] != "stopped" {
		t.Fatalf("stop: %d %v", st, b)
	}
	st, b = c.do("POST", stop, map[string]string{"reason": "user_stop"}, nil)
	expect(t, "stop again", st, 200, b)
	st, b = send(4, frame)
	if st != 409 || code(b) != "SESSION_NOT_ACTIVE" {
		t.Fatalf("frame after stop: %d %v", st, b)
	}

	st, b = c.do("DELETE", fmt.Sprintf("/zones/%d?version=1", zid), nil, nil)
	if st != 409 || code(b) != "ZONE_IN_USE" {
		t.Fatalf("delete used zone: %d %v", st, b)
	}

	st, b = c.do("POST", "/auth/logout", nil, nil)
	expect(t, "logout", st, 204, b)
	st, b = c.do("GET", "/auth/me", nil, nil)
	expect(t, "me after logout", st, 401, b)
}
