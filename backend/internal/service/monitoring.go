package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"k3/backend/internal/aiclient"
	"k3/backend/internal/config"
	"k3/backend/internal/domain"
	"k3/backend/internal/repository/sqlite"
	"k3/backend/internal/storage"
)

const (
	frameCacheSize   = 30              // SRS §6.5
	maxReplayLag     = 3 * time.Second // SRS §6.3 step 2
	maxCaptureSkew   = 5 * time.Minute // captured_at sanity vs server clock
	aiControlTimeout = 3 * time.Second
)

// Monitoring owns the single active camera session (SRS §5.4, §6).
type Monitoring struct {
	Store    *sqlite.Store
	AI       aiclient.Client
	Evidence *storage.Evidence
	Cfg      *config.Config

	mu     sync.Mutex // guards active and start
	active *runtime
}

// runtime is the in-memory state of the active session. mu is the session
// lock: frames, stop and idle checks are serialised on it.
type runtime struct {
	mu          sync.Mutex
	sess        *domain.Session
	engine      *Temporal
	supported   map[string]bool
	cache       map[int64]cachedFrame
	order       []int64
	maxSeq      int64
	lastReceipt time.Time
	lastValid   time.Time
	base        time.Time // receipt - sample_elapsed of the first frame
	closed      bool
}

type cachedFrame struct {
	sha    string
	result *FrameResult
}

type StartInput struct {
	ProjectID int64  `json:"project_id"`
	ZoneID    int64  `json:"zone_id"`
	Source    string `json:"source"`
}

type FrameInput struct {
	Sequence        int64
	CapturedAt      time.Time
	SampleElapsedMS int64
	JPEG            []byte
	Receipt         time.Time // taken when the request arrived (monotonic)
}

type TrackView struct {
	TrackID          int            `json:"track_id"`
	TrackKey         string         `json:"track_key"`
	PersonConfidence float64        `json:"person_confidence"`
	PersonBBox       [4]float64     `json:"person_bbox"`
	Observations     []aiclient.PPE `json:"observations"`
}

type FrameEvent struct {
	Type               string `json:"type"`
	FindingID          int64  `json:"finding_id"`
	VerificationStatus string `json:"verification_status"`
	EvidenceURL        string `json:"evidence_url"`
}

type FrameResult struct {
	SessionID     int64        `json:"session_id"`
	FrameSequence int64        `json:"frame_sequence"`
	CapturedAt    string       `json:"captured_at"`
	ReceivedAt    string       `json:"received_at"`
	Width         int          `json:"width"`
	Height        int          `json:"height"`
	InferenceMS   int64        `json:"inference_ms"`
	ModelVersion  string       `json:"model_version"`
	Mode          string       `json:"mode"`
	Tracks        []TrackView  `json:"tracks"`
	Events        []FrameEvent `json:"events"`
}

func errAIUnavailable() error {
	return domain.NewError(http.StatusServiceUnavailable, "AI_UNAVAILABLE", "Layanan AI tidak tersedia.")
}

func errNotActive() error {
	return domain.Conflict("SESSION_NOT_ACTIVE", "Sesi monitoring tidak aktif.")
}

func errNotOwner() error {
	return domain.Forbidden("FORBIDDEN", "Sesi ini dimulai oleh petugas lain.")
}

func (m *Monitoring) sessionConfig() domain.SessionConfig {
	return domain.SessionConfig{
		SampleFPS:        m.Cfg.FrameTargetFPS,
		ConfirmHits:      m.Cfg.ConfirmHits,
		ConfirmMaxFrames: m.Cfg.ConfirmMaxFrames,
		ConfirmWindowMS:  m.Cfg.ConfirmWindow.Milliseconds(),
		TrackTimeoutMS:   m.Cfg.TrackTimeout.Milliseconds(),
	}
}

// checkZone enforces BR-01: project and zone active and related.
func checkZone(ctx context.Context, q sqlite.Q, projectID, zoneID int64) error {
	z, err := q.Zone(ctx, zoneID)
	if isNotFound(err) || (err == nil && z.ProjectID != projectID) {
		return domain.NewError(http.StatusUnprocessableEntity, "PROJECT_ZONE_MISMATCH", "Zona tidak termasuk proyek yang dipilih.")
	}
	if err != nil {
		return err
	}
	p, err := q.Project(ctx, projectID)
	if err != nil {
		return err
	}
	if p.Status != domain.StatusActive || z.Status != domain.StatusActive {
		return domain.NewError(http.StatusUnprocessableEntity, "NOT_ACTIVE", "Proyek dan zona harus berstatus aktif.")
	}
	return nil
}

// Start creates a session. Mode comes from server config, never the browser.
func (m *Monitoring) Start(ctx context.Context, userID int64, in StartInput) (*domain.Session, error) {
	mode := m.Cfg.AIMode
	if in.Source == "" {
		in.Source = domain.SourceBrowserWebcam
	}
	wantSource := domain.SourceBrowserWebcam
	if mode == domain.ModeManual {
		wantSource = domain.SourceManualEntry
	}
	if in.Source != wantSource {
		return nil, domain.Validation(map[string]string{"source": "must be " + wantSource + " in " + mode + " mode"})
	}
	if in.ProjectID <= 0 || in.ZoneID <= 0 {
		return nil, domain.Validation(map[string]string{"project_id": "required", "zone_id": "required"})
	}
	if err := checkZone(ctx, m.Store.Q(), in.ProjectID, in.ZoneID); err != nil {
		return nil, err
	}

	now := sqlite.Now()
	s := &domain.Session{SessionKey: storage.NewUUID(), ZoneID: in.ZoneID, StartedBy: userID, Source: in.Source,
		Mode: mode, Config: m.sessionConfig(), StartedAt: now}

	if mode == domain.ModeManual {
		// Manual fallback: a closed session that only holds manual findings.
		reason := "manual_entry"
		s.Status, s.EndedAt, s.EndReason = domain.SessionStopped, &now, &reason
		return m.insertSession(ctx, in, s)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active != nil {
		return nil, domain.Conflict("CAMERA_BUSY", "Sudah ada sesi monitoring aktif.")
	}

	actx, cancel := context.WithTimeout(ctx, aiControlTimeout)
	defer cancel()
	mi, err := m.AI.ModelInfo(actx)
	if err != nil {
		slog.Warn("ai model-info failed", "err", err)
		return nil, errAIUnavailable()
	}
	if !mi.Ready || mi.Mode != mode {
		return nil, domain.NewError(http.StatusServiceUnavailable, "MODEL_NOT_READY", "Model AI belum siap untuk mode "+mode+".")
	}
	supported := map[string]bool{}
	for _, v := range mi.SupportedViolations {
		if v == domain.ViolationNoHelmet || v == domain.ViolationNoVest {
			supported[v] = true
			s.Config.SupportedViolations = append(s.Config.SupportedViolations, v)
		}
	}
	s.Status = domain.SessionActive
	s.ModelVersion, s.EngineInstanceID = &mi.ModelVersion, &mi.EngineInstanceID

	if err := m.AI.StartSession(actx, s.SessionKey, mode); err != nil {
		slog.Warn("ai session start failed", "err", err)
		return nil, errAIUnavailable()
	}
	out, err := m.insertSession(ctx, in, s)
	if err != nil {
		m.stopAI(s.SessionKey)
		return nil, err
	}
	m.active = &runtime{
		sess:      out,
		engine:    NewTemporal(m.Cfg.ConfirmHits, m.Cfg.ConfirmMaxFrames, m.Cfg.ConfirmWindow, m.Cfg.TrackTimeout),
		supported: supported,
		cache:     map[int64]cachedFrame{},
		lastValid: time.Now(),
	}
	return out, nil
}

func (m *Monitoring) insertSession(ctx context.Context, in StartInput, s *domain.Session) (*domain.Session, error) {
	var out *domain.Session
	err := m.Store.Tx(ctx, func(q sqlite.Q) error {
		// Re-check inside the writer transaction: master data may have changed during the AI call.
		if err := checkZone(ctx, q, in.ProjectID, in.ZoneID); err != nil {
			return err
		}
		var err error
		out, err = q.CreateSession(ctx, s)
		return err
	})
	return out, err
}

func (m *Monitoring) stopAI(key string) {
	ctx, cancel := context.WithTimeout(context.Background(), aiControlTimeout)
	defer cancel()
	if err := m.AI.StopSession(ctx, key); err != nil {
		slog.Warn("ai session stop failed", "err", err)
	}
}

func (m *Monitoring) current(id int64) *runtime {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active != nil && m.active.sess.ID == id {
		return m.active
	}
	return nil
}

// closeLocked ends the runtime; caller holds rt.mu.
func (m *Monitoring) closeLocked(rt *runtime, status, reason string) {
	if rt.closed {
		return
	}
	rt.closed = true
	if _, err := m.Store.Q().EndSession(context.Background(), rt.sess.ID, status, reason); err != nil {
		slog.Error("end session", "session_id", rt.sess.ID, "err", err)
	}
	m.stopAI(rt.sess.SessionKey)
	m.mu.Lock()
	if m.active == rt {
		m.active = nil
	}
	m.mu.Unlock()
	slog.Info("session closed", "session_id", rt.sess.ID, "status", status, "reason", reason)
}

// Stop is idempotent: a closed session is returned unchanged.
func (m *Monitoring) Stop(ctx context.Context, userID, id int64, reason string) (*domain.Session, error) {
	s, err := m.Store.Q().Session(ctx, id)
	if err != nil {
		return nil, err
	}
	if s.StartedBy != userID {
		return nil, errNotOwner()
	}
	if s.Status != domain.SessionActive {
		return s, nil
	}
	if reason == "" {
		reason = "user_stop"
	}
	if rt := m.current(id); rt != nil {
		rt.mu.Lock() // waits for an in-flight frame (bounded by the frame deadline)
		m.closeLocked(rt, domain.SessionStopped, reason)
		rt.mu.Unlock()
	} else if _, err := m.Store.Q().EndSession(ctx, id, domain.SessionStopped, reason); err != nil {
		return nil, err
	}
	return m.Store.Q().Session(ctx, id)
}

// StopForUser stops the active session owned by userID (used on logout).
func (m *Monitoring) StopForUser(ctx context.Context, userID int64) {
	m.mu.Lock()
	rt := m.active
	m.mu.Unlock()
	if rt != nil && rt.sess.StartedBy == userID {
		if _, err := m.Stop(ctx, userID, rt.sess.ID, "logout"); err != nil {
			slog.Error("stop on logout", "err", err)
		}
	}
}

// Reconcile runs at startup: sessions left active by a previous process are
// interrupted and their trackers stopped (SRS §6.5).
func (m *Monitoring) Reconcile(ctx context.Context) error {
	sessions, err := m.Store.Q().ActiveSessions(ctx)
	if err != nil {
		return err
	}
	for _, s := range sessions {
		if _, err := m.Store.Q().EndSession(ctx, s.ID, domain.SessionInterrupted, "server_restart"); err != nil {
			return err
		}
		m.stopAI(s.SessionKey)
		slog.Info("session interrupted on startup", "session_id", s.ID)
	}
	return nil
}

// Tick expires tracks and interrupts an idle session. Called every second.
func (m *Monitoring) Tick(now time.Time) {
	m.mu.Lock()
	rt := m.active
	m.mu.Unlock()
	if rt == nil {
		return
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if rt.closed {
		return
	}
	rt.engine.Expire(now)
	if now.Sub(rt.lastValid) >= m.Cfg.SessionIdleTimeout {
		m.closeLocked(rt, domain.SessionInterrupted, "idle_timeout")
	}
}

// Frame runs the §6.3/§6.5 pipeline for one sampled JPEG.
func (m *Monitoring) Frame(ctx context.Context, userID, id int64, in FrameInput) (*FrameResult, error) {
	w, h, err := checkJPEG(in.JPEG, m.Cfg.FrameMaxPixels)
	if err != nil {
		return nil, err
	}
	if skew := time.Since(in.CapturedAt); skew > maxCaptureSkew || skew < -maxCaptureSkew {
		return nil, domain.BadRequest("X-Captured-At terlalu jauh dari waktu server.")
	}

	rt := m.current(id)
	if rt == nil {
		s, err := m.Store.Q().Session(ctx, id)
		if err != nil {
			return nil, err
		}
		if s.StartedBy != userID {
			return nil, errNotOwner()
		}
		return nil, errNotActive()
	}
	if rt.sess.StartedBy != userID {
		return nil, errNotOwner()
	}

	rt.mu.Lock()
	defer rt.mu.Unlock()
	if rt.closed {
		return nil, errNotActive()
	}

	sum := sha256.Sum256(in.JPEG)
	sha := hex.EncodeToString(sum[:])
	if c, ok := rt.cache[in.Sequence]; ok {
		if c.sha != sha {
			return nil, domain.Conflict("FRAME_SEQUENCE_CONFLICT", "Sequence sama dengan isi frame berbeda.")
		}
		return c.result, nil // retry: no second model/tracker step
	}
	if in.Sequence <= rt.maxSeq {
		return nil, domain.Conflict("FRAME_TOO_OLD", "Frame lebih lama dari frame terakhir yang diproses.")
	}
	minGap := time.Second / time.Duration(m.Cfg.FrameTargetFPS) / 2
	if !rt.lastReceipt.IsZero() && in.Receipt.Sub(rt.lastReceipt) < minGap {
		e := domain.NewError(http.StatusTooManyRequests, "FRAME_TOO_FAST", "Frame dikirim lebih cepat dari batas sampling.")
		e.RetryAfter = 1
		return nil, e
	}
	elapsed := time.Duration(in.SampleElapsedMS) * time.Millisecond
	if rt.base.IsZero() {
		rt.base = in.Receipt.Add(-elapsed)
	} else if in.Receipt.Sub(rt.base.Add(elapsed)) > maxReplayLag {
		return nil, domain.Conflict("FRAME_STALE", "Frame terlalu lama tertunda; kirim frame baru.")
	}

	res, err := m.infer(ctx, rt, aiclient.InferRequest{
		SessionKey: rt.sess.SessionKey, FrameSequence: in.Sequence, CapturedAt: in.CapturedAt.UTC().Format(domain.TimeFormat),
		SampleElapsedMS: in.SampleElapsedMS, SHA256: sha, JPEG: in.JPEG,
	})
	if err != nil {
		return nil, err
	}
	if res.Width != w || res.Height != h || res.FrameSequence != in.Sequence || res.Mode != rt.sess.Mode {
		rt.maxSeq = in.Sequence
		return nil, domain.NewError(http.StatusBadGateway, "INVALID_AI_OUTPUT", "Hasil AI tidak sesuai frame yang dikirim.")
	}

	rt.maxSeq, rt.lastReceipt, rt.lastValid = in.Sequence, in.Receipt, in.Receipt
	keys, events := rt.engine.Observe(in.Receipt, res.Persons, rt.supported)

	receivedAt := in.Receipt.UTC().Format(domain.TimeFormat)
	out := &FrameResult{
		SessionID: rt.sess.ID, FrameSequence: in.Sequence, CapturedAt: in.CapturedAt.UTC().Format(domain.TimeFormat),
		ReceivedAt: receivedAt, Width: w, Height: h, InferenceMS: res.InferenceMS, ModelVersion: res.ModelVersion,
		Mode: res.Mode, Tracks: []TrackView{}, Events: []FrameEvent{},
	}
	for i, p := range res.Persons {
		obs := p.PPE
		if obs == nil {
			obs = []aiclient.PPE{}
		}
		out.Tracks = append(out.Tracks, TrackView{TrackID: p.TrackID, TrackKey: keys[i], PersonConfidence: p.Confidence, PersonBBox: p.BBox, Observations: obs})
	}

	for _, ev := range events {
		fid, err := m.recordFinding(ctx, rt, ev, in, out, sha)
		if err != nil {
			slog.Error("persist finding", "session_id", rt.sess.ID, "seq", in.Sequence, "err", err)
			m.closeLocked(rt, domain.SessionInterrupted, "storage_error")
			return nil, domain.NewError(http.StatusInternalServerError, "STORAGE_ERROR", "Gagal menyimpan bukti; sesi dihentikan.")
		}
		rt.engine.MarkRecorded(ev.TrackKey, ev.Violation)
		out.Events = append(out.Events, FrameEvent{Type: "finding_created", FindingID: fid, VerificationStatus: "pending",
			EvidenceURL: fmt.Sprintf("/api/v1/findings/%d/evidence", fid)})
	}

	if err := m.Store.Q().TouchSession(ctx, rt.sess.ID, receivedAt); err != nil {
		slog.Warn("touch session", "err", err)
	}
	rt.cache[in.Sequence] = cachedFrame{sha: sha, result: out}
	rt.order = append(rt.order, in.Sequence)
	if len(rt.order) > frameCacheSize {
		delete(rt.cache, rt.order[0])
		rt.order = rt.order[1:]
	}
	slog.Info("frame", "session_id", rt.sess.ID, "seq", in.Sequence, "inference_ms", res.InferenceMS,
		"persons", len(res.Persons), "events", len(out.Events), "model_version", res.ModelVersion)
	return out, nil
}

func checkJPEG(b []byte, maxPixels int) (int, int, error) {
	if len(b) < 3 || b[0] != 0xFF || b[1] != 0xD8 || b[2] != 0xFF {
		return 0, 0, domain.NewError(http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Frame harus JPEG.")
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return 0, 0, domain.NewError(http.StatusUnprocessableEntity, "INVALID_IMAGE", "JPEG rusak atau tidak dapat dibaca.")
	}
	if cfg.Width*cfg.Height > maxPixels {
		return 0, 0, domain.NewError(http.StatusRequestEntityTooLarge, "IMAGE_TOO_LARGE", "Resolusi frame melebihi batas.")
	}
	return cfg.Width, cfg.Height, nil
}

// infer calls the AI with a per-attempt timeout and one same-sequence retry
// inside the total frame deadline. Caller holds rt.mu.
func (m *Monitoring) infer(ctx context.Context, rt *runtime, req aiclient.InferRequest) (*aiclient.InferResult, error) {
	// Detach from the browser request: a dropped connection must not leave the tracker state ambiguous.
	total, cancel := context.WithTimeout(context.WithoutCancel(ctx), m.Cfg.FrameTotalDeadline)
	defer cancel()

	var res *aiclient.InferResult
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		actx, acancel := context.WithTimeout(total, m.Cfg.AITimeout)
		res, err = m.AI.Infer(actx, req)
		acancel()
		if err == nil || !aiclient.IsTimeout(err) || total.Err() != nil {
			break
		}
	}

	var se *aiclient.StatusError
	switch {
	case err == nil:
	case aiclient.IsInvalidOutput(err):
		rt.maxSeq = req.FrameSequence
		return nil, domain.NewError(http.StatusBadGateway, "INVALID_AI_OUTPUT", "Hasil AI tidak valid.")
	case errors.As(err, &se) && se.Status == http.StatusUnprocessableEntity:
		return nil, domain.NewError(http.StatusUnprocessableEntity, "INVALID_IMAGE", "Gambar ditolak layanan AI.")
	case errors.As(err, &se) && se.Status == http.StatusServiceUnavailable:
		rt.maxSeq = req.FrameSequence
		return nil, domain.NewError(http.StatusServiceUnavailable, "MODEL_ERROR", "Inferensi gagal untuk frame ini.")
	case aiclient.IsTimeout(err):
		m.closeLocked(rt, domain.SessionInterrupted, "ai_timeout")
		return nil, domain.NewError(http.StatusGatewayTimeout, "AI_TIMEOUT", "Layanan AI tidak merespons; sesi dihentikan.")
	default:
		// 409 (session/order mismatch), 403, network errors: tracker state is no longer certain.
		slog.Error("ai infer", "session_id", rt.sess.ID, "err", err)
		m.closeLocked(rt, domain.SessionInterrupted, "ai_error")
		return nil, errAIUnavailable()
	}
	if res.SessionKey != rt.sess.SessionKey || rt.sess.EngineInstanceID == nil || res.EngineInstanceID != *rt.sess.EngineInstanceID {
		m.closeLocked(rt, domain.SessionInterrupted, "tracker_reset")
		return nil, domain.NewError(http.StatusServiceUnavailable, "TRACKER_RESET", "Layanan AI dimulai ulang; mulai sesi baru.")
	}
	return res, nil
}

// recordFinding writes evidence then inserts the pending finding (SRS §6.6).
func (m *Monitoring) recordFinding(ctx context.Context, rt *runtime, ev Event, in FrameInput, fr *FrameResult, sha string) (int64, error) {
	rel, err := m.Evidence.Save(in.JPEG, time.Now().UTC())
	if err != nil {
		return 0, err
	}
	personBox, _ := json.Marshal(ev.Person.BBox)
	violBox, _ := json.Marshal(ev.PPE.BBox)
	raw, _ := json.Marshal(ev.Person)
	conf := 0.0
	if ev.PPE.Confidence != nil {
		conf = *ev.PPE.Confidence
	}
	id, created, err := m.Store.Q().InsertFinding(ctx, &domain.NewFinding{
		SessionID: rt.sess.ID, TrackID: ev.TrackID, TrackKey: ev.TrackKey, Violation: ev.Violation, Confidence: conf,
		PersonBBoxJSON: string(personBox), ViolationBBoxJSON: string(violBox), RawDetectionJSON: string(raw),
		ModelVersion: fr.ModelVersion, FrameSequence: in.Sequence, FrameWidth: fr.Width, FrameHeight: fr.Height,
		EvidencePath: rel, EvidenceSHA256: sha, CapturedAt: fr.CapturedAt, ReceivedAt: fr.ReceivedAt,
	})
	if err != nil || !created {
		m.Evidence.Remove(rel)
	}
	return id, err
}

// EvidenceFile returns the absolute evidence path for a finding, 410 if the file is gone.
func (m *Monitoring) EvidenceFile(ctx context.Context, findingID int64) (string, error) {
	rel, err := m.Store.Q().FindingEvidence(ctx, findingID)
	if err != nil {
		return "", err
	}
	p, err := m.Evidence.Path(rel)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(p); err != nil {
		return "", domain.NewError(http.StatusGone, "EVIDENCE_MISSING", "File bukti tidak ditemukan.")
	}
	return p, nil
}
