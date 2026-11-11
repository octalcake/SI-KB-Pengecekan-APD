package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"k3/backend/internal/config"
	"k3/backend/internal/domain"
	"k3/backend/internal/gemini"
	"k3/backend/internal/repository/sqlite"
)

const (
	maxReportChars = 20000
	maxTitleChars  = 200
)

// Reports implements SRS §5.6 / §9.7. Gemini is nil when GEMINI_ENABLED=false.
type Reports struct {
	Store  *sqlite.Store
	Gemini gemini.Generator
	Cfg    *config.Config

	mu      sync.Mutex
	locks   map[int64]*sync.Mutex // per-session generate/regenerate lock
	expired map[string]bool       // request keys superseded by a regenerate
}

func (s *Reports) sessionLock(id int64) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.locks == nil {
		s.locks = map[int64]*sync.Mutex{}
	}
	if s.locks[id] == nil {
		s.locks[id] = &sync.Mutex{}
	}
	return s.locks[id]
}

func (s *Reports) keyExpired(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.expired[key]
}

// shortcut: superseded keys live in memory only; after a restart an old key is
// treated as unknown. Upgrade to an idempotency table if durable replay matters.
func (s *Reports) expireKey(key *string) {
	if key == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.expired == nil {
		s.expired = map[string]bool{}
	}
	s.expired[*key] = true
}

type source struct {
	snap   *domain.Snapshot
	json   string
	hash   string
	status string
}

// loadSource builds the canonical snapshot. Struct field order is fixed, so
// json.Marshal is deterministic and the hash changes only when the data does.
func loadSource(ctx context.Context, q sqlite.Q, sessionID int64) (*source, error) {
	snap, status, err := q.SnapshotHeader(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if snap.Findings, err = q.ConfirmedForSnapshot(ctx, sessionID); err != nil {
		return nil, err
	}
	b, err := json.Marshal(snap)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(b)
	return &source{snap: snap, json: string(b), hash: hex.EncodeToString(sum[:]), status: status}, nil
}

func (src *source) usable() error {
	if src.status == domain.SessionActive {
		return domain.Conflict("SESSION_STILL_ACTIVE", "Hentikan sesi monitoring sebelum membuat laporan.")
	}
	if len(src.snap.Findings) == 0 {
		return domain.NewError(http.StatusUnprocessableEntity, "NO_CONFIRMED_FINDINGS", "Belum ada temuan yang dikonfirmasi petugas.")
	}
	return nil
}

func (src *source) refs() []string {
	out := make([]string, len(src.snap.Findings))
	for i, f := range src.snap.Findings {
		out[i] = fmt.Sprintf("F-%d", f.ID)
	}
	return out
}

func errLocked() error {
	return domain.Conflict("REPORT_LOCKED", "Laporan yang disetujui tidak dapat diubah.")
}

func errGeminiUnavailable() error {
	return domain.NewError(http.StatusServiceUnavailable, "GEMINI_UNAVAILABLE", "Gemini tidak tersedia. Coba lagi atau buat draft manual/template.")
}

// Get returns a report with is_stale computed from the live source (drafts only).
func (s *Reports) Get(ctx context.Context, id int64) (*domain.Report, error) {
	r, err := s.Store.Q().Report(ctx, id)
	if err != nil {
		return nil, err
	}
	return r, s.fillStale(ctx, r)
}

func (s *Reports) fillStale(ctx context.Context, r *domain.Report) error {
	if r.Status != "draft" {
		r.IsStale = false // approved reports keep their historical snapshot
		return nil
	}
	src, err := loadSource(ctx, s.Store.Q(), r.SessionID)
	if err != nil {
		return err
	}
	r.IsStale = src.hash != r.SourceHash
	return nil
}

func (s *Reports) List(ctx context.Context, projectID, sessionID int64, status string, page, size int) ([]domain.Report, int, error) {
	items, total, err := s.Store.Q().ListReports(ctx, projectID, sessionID, status, page, size)
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		if err := s.fillStale(ctx, &items[i]); err != nil {
			return nil, 0, err
		}
	}
	return items, total, nil
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func checkKey(key string) error {
	if !uuidRe.MatchString(key) {
		return domain.Validation(map[string]string{"request_key": "must be a UUID"})
	}
	return nil
}

var (
	emailRe = regexp.MustCompile(`[\w.+-]+@[\w-]+\.[\w.-]+`)
	phoneRe = regexp.MustCompile(`\+?\d[\d\s().-]{7,}\d`)
)

// sanitize redacts emails and phone numbers before notes leave the machine.
// shortcut: names cannot be detected reliably; officers review notes before generating.
func sanitize(s string) string {
	return phoneRe.ReplaceAllString(emailRe.ReplaceAllString(s, "[disamarkan]"), "[disamarkan]")
}

// payload is the minimum data sent to Gemini (SRS §13.3): no photo, track ID, names or locations.
func (s *Reports) payload(src *source) ([]byte, string, error) {
	type item struct {
		FindingRef   string `json:"finding_ref"`
		Category     string `json:"category"`
		ObservedAt   string `json:"observed_at"`
		VerifiedNote string `json:"verified_note"`
		ActionStatus string `json:"action_status"`
		ActionNote   string `json:"action_note"`
	}
	p := struct {
		SessionRef     string `json:"session_ref"`
		Mode           string `json:"mode"`
		Timezone       string `json:"timezone"`
		ConfirmedCount int    `json:"confirmed_count"`
		Findings       []item `json:"findings"`
	}{SessionRef: fmt.Sprintf("S-%d", src.snap.SessionID), Mode: src.snap.Mode,
		Timezone: s.Cfg.DisplayTimezone.String(), ConfirmedCount: len(src.snap.Findings)}
	for _, f := range src.snap.Findings {
		p.Findings = append(p.Findings, item{FindingRef: fmt.Sprintf("F-%d", f.ID), Category: f.ViolationType,
			ObservedAt: s.localTime(f.CapturedAt, time.RFC3339), VerifiedNote: sanitize(f.Notes),
			ActionStatus: f.ActionStatus, ActionNote: sanitize(f.ActionNotes)})
	}
	b, err := json.Marshal(p)
	sum := sha256.Sum256(b)
	return b, hex.EncodeToString(sum[:]), err
}

func (s *Reports) localTime(utc, layout string) string {
	t, err := time.Parse(time.RFC3339Nano, utc)
	if err != nil {
		return utc
	}
	return t.In(s.Cfg.DisplayTimezone).Format(layout)
}

// generate calls Gemini and validates the output; no lock or transaction is held by the caller's DB.
func (s *Reports) generate(ctx context.Context, src *source) (*gemini.Narrative, string, error) {
	input, payloadHash, err := s.payload(src)
	if err != nil {
		return nil, "", err
	}
	n, err := s.Gemini.Generate(ctx, input)
	if err == nil {
		err = gemini.Validate(n, src.refs())
	}
	var ie *gemini.InvalidOutputError
	switch {
	case err == nil:
		return n, payloadHash, nil
	case errors.As(err, &ie):
		return nil, "", domain.NewError(http.StatusBadGateway, "INVALID_GEMINI_OUTPUT", "Output Gemini tidak valid; coba lagi atau buat draft manual.")
	default:
		return nil, "", errGeminiUnavailable()
	}
}

func (s *Reports) header(src *source) string {
	snap := src.snap
	return fmt.Sprintf("Proyek: %s\nZona: %s\nSesi: S-%d (mode %s)\n", snap.Project.Name, snap.Zone.Name, snap.SessionID, snap.Mode)
}

// footer holds the official numbers, computed by Go rather than the model.
func (s *Reports) footer(src *source) string {
	return fmt.Sprintf("\nSumber (dihitung aplikasi): %d temuan terkonfirmasi petugas: %s.\n"+
		"Draft ini berisi indikasi visual yang diverifikasi petugas, bukan putusan pelanggaran atau sertifikasi keselamatan lokasi.",
		len(src.snap.Findings), strings.Join(src.refs(), ", "))
}

func (s *Reports) renderNarrative(src *source, n *gemini.Narrative) (string, string) {
	var b strings.Builder
	b.WriteString(s.header(src))
	b.WriteString("\n" + strings.TrimSpace(n.Summary) + "\n\nRincian:\n")
	for _, d := range n.Details {
		fmt.Fprintf(&b, "- [%s] %s\n  Tindak lanjut: %s\n", d.FindingRef, strings.TrimSpace(d.Observation), strings.TrimSpace(d.FollowUp))
	}
	if len(n.MissingInformation) > 0 {
		b.WriteString("\nInformasi belum tersedia:\n")
		for _, m := range n.MissingInformation {
			b.WriteString("- " + strings.TrimSpace(m) + "\n")
		}
	}
	b.WriteString(s.footer(src))
	title := strings.TrimSpace(n.Title)
	if r := []rune(title); len(r) > maxTitleChars {
		title = string(r[:maxTitleChars])
	}
	return title, b.String()
}

func (s *Reports) renderTemplate(src *source) (string, string) {
	var b strings.Builder
	b.WriteString(s.header(src))
	b.WriteString("\nTemuan terkonfirmasi petugas:\n")
	labels := map[string]string{"NO_HELMET": "indikasi tanpa helm", "NO_VEST": "indikasi tanpa rompi"}
	for _, f := range src.snap.Findings {
		follow := "belum dicatat"
		if f.ActionNotes != "" {
			follow = f.ActionStatus + " - " + f.ActionNotes
		}
		fmt.Fprintf(&b, "- [F-%d] %s pada %s. Catatan petugas: %s. Tindak lanjut: %s.\n",
			f.ID, labels[f.ViolationType], s.localTime(f.CapturedAt, "02-01-2006 15:04:05 MST"), f.Notes, follow)
	}
	b.WriteString(s.footer(src))
	return fmt.Sprintf("Laporan inspeksi sesi S-%d", src.snap.SessionID), b.String()
}

// Generate creates a Gemini draft. Replaying the same request_key returns the same report.
func (s *Reports) Generate(ctx context.Context, userID, sessionID int64, key string) (*domain.Report, error) {
	if s.Gemini == nil {
		return nil, errGeminiUnavailable()
	}
	if sessionID <= 0 {
		return nil, domain.Validation(map[string]string{"session_id": "required"})
	}
	if err := checkKey(key); err != nil {
		return nil, err
	}
	lock := s.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()

	if s.keyExpired(key) {
		return nil, domain.Conflict("REQUEST_KEY_EXPIRED", "request_key sudah diganti oleh regenerate; muat laporan terbaru.")
	}
	src, err := loadSource(ctx, s.Store.Q(), sessionID)
	if err != nil {
		return nil, err
	}
	if prev, err := s.Store.Q().ReportByRequestKey(ctx, key); err == nil {
		_, ph, perr := s.payload(src)
		if perr != nil {
			return nil, perr
		}
		if prev.SessionID != sessionID || prev.GenerationPayloadHash == nil || *prev.GenerationPayloadHash != ph {
			return nil, domain.Conflict("IDEMPOTENCY_CONFLICT", "request_key sudah dipakai dengan input berbeda.")
		}
		return s.Get(ctx, prev.ID)
	} else if !isNotFound(err) {
		return nil, err
	}
	if err := src.usable(); err != nil {
		return nil, err
	}
	if _, total, err := s.Store.Q().ListReports(ctx, 0, sessionID, "", 1, 1); err != nil || total > 0 {
		return nil, orErr(err, domain.Conflict("REPORT_EXISTS", "Sesi ini sudah memiliki laporan."))
	}

	n, payloadHash, err := s.generate(ctx, src)
	if err != nil {
		return nil, err
	}
	title, content := s.renderNarrative(src, n)
	model, prompt := s.Gemini.Model(), s.Cfg.ReportPromptVersion
	var id int64
	err = s.Store.Tx(ctx, func(q sqlite.Q) error {
		now, err := loadSource(ctx, q, sessionID)
		if err != nil {
			return err
		}
		if now.hash != src.hash {
			return domain.Conflict("SOURCE_CHANGED", "Temuan berubah selama draft dibuat; coba lagi.")
		}
		id, err = q.InsertReport(ctx, &domain.Report{SessionID: sessionID, CreatedBy: userID, Title: title, Content: content,
			GeneratedBy: "gemini", GeminiModel: &model, PromptVersion: &prompt, GenerationRequestKey: &key,
			GenerationPayloadHash: &payloadHash, SnapshotJSON: src.json, SourceHash: src.hash})
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

// Regenerate replaces a draft's narrative and source with a fresh Gemini draft.
func (s *Reports) Regenerate(ctx context.Context, id, version int64, key string) (*domain.Report, error) {
	if s.Gemini == nil {
		return nil, errGeminiUnavailable()
	}
	if err := checkKey(key); err != nil {
		return nil, err
	}
	r, err := s.Store.Q().Report(ctx, id)
	if err != nil {
		return nil, err
	}
	lock := s.sessionLock(r.SessionID)
	lock.Lock()
	defer lock.Unlock()

	if r, err = s.Store.Q().Report(ctx, id); err != nil {
		return nil, err
	}
	if r.GenerationRequestKey != nil && *r.GenerationRequestKey == key {
		return s.Get(ctx, id) // replay of the regenerate that produced this version
	}
	if s.keyExpired(key) {
		return nil, domain.Conflict("REQUEST_KEY_EXPIRED", "request_key sudah diganti oleh regenerate; muat laporan terbaru.")
	}
	if r.Status != "draft" {
		return nil, errLocked()
	}
	if r.Version != version {
		return nil, domain.VersionConflict()
	}
	src, err := loadSource(ctx, s.Store.Q(), r.SessionID)
	if err != nil {
		return nil, err
	}
	if err := src.usable(); err != nil {
		return nil, err
	}
	n, payloadHash, err := s.generate(ctx, src)
	if err != nil {
		return nil, err
	}
	title, content := s.renderNarrative(src, n)
	model, prompt := s.Gemini.Model(), s.Cfg.ReportPromptVersion
	oldKey := r.GenerationRequestKey
	err = s.Store.Tx(ctx, func(q sqlite.Q) error {
		now, err := loadSource(ctx, q, r.SessionID)
		if err != nil {
			return err
		}
		if now.hash != src.hash {
			return domain.Conflict("SOURCE_CHANGED", "Temuan berubah selama draft dibuat; draft lama dipertahankan.")
		}
		return q.RegenerateReport(ctx, &domain.Report{ID: id, Version: version, Title: title, Content: content,
			GeneratedBy: "gemini", GeminiModel: &model, PromptVersion: &prompt, GenerationRequestKey: &key,
			GenerationPayloadHash: &payloadHash, SnapshotJSON: src.json, SourceHash: src.hash})
	})
	if err != nil {
		return nil, err
	}
	s.expireKey(oldKey)
	return s.Get(ctx, id)
}

type ManualReportInput struct {
	SessionID   int64   `json:"session_id"`
	Title       *string `json:"title"`
	Content     *string `json:"content"`
	UseTemplate bool    `json:"use_template"`
}

// CreateManual makes a manual or template draft; generated_by is set by the server.
func (s *Reports) CreateManual(ctx context.Context, userID int64, in ManualReportInput) (*domain.Report, error) {
	fields := map[string]string{}
	if in.SessionID <= 0 {
		fields["session_id"] = "required"
	}
	if in.UseTemplate && (in.Title != nil || in.Content != nil) {
		fields["use_template"] = "cannot be combined with title/content"
	}
	if !in.UseTemplate {
		checkLen(fields, "title", str(in.Title, ""), 1, maxTitleChars)
		checkLen(fields, "content", str(in.Content, ""), 1, maxReportChars)
	}
	if len(fields) > 0 {
		return nil, domain.Validation(fields)
	}
	var id int64
	err := s.Store.Tx(ctx, func(q sqlite.Q) error {
		src, err := loadSource(ctx, q, in.SessionID)
		if err != nil {
			return err
		}
		if err := src.usable(); err != nil {
			return err
		}
		r := &domain.Report{SessionID: in.SessionID, CreatedBy: userID, GeneratedBy: "manual",
			Title: str(in.Title, ""), Content: str(in.Content, ""), SnapshotJSON: src.json, SourceHash: src.hash}
		if in.UseTemplate {
			r.GeneratedBy = "template"
			r.Title, r.Content = s.renderTemplate(src)
		}
		id, err = q.InsertReport(ctx, r)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

type ReportEditInput struct {
	Version *int64  `json:"version"`
	Title   *string `json:"title"`
	Content *string `json:"content"`
}

// Update edits draft text only; it never makes a stale source fresh.
func (s *Reports) Update(ctx context.Context, id int64, in ReportEditInput) (*domain.Report, error) {
	if in.Version == nil {
		return nil, domain.Validation(map[string]string{"version": "required"})
	}
	err := s.Store.Tx(ctx, func(q sqlite.Q) error {
		r, err := q.Report(ctx, id)
		if err != nil {
			return err
		}
		if r.Status != "draft" {
			return errLocked()
		}
		title, content := str(in.Title, r.Title), str(in.Content, r.Content)
		fields := map[string]string{}
		checkLen(fields, "title", title, 1, maxTitleChars)
		checkLen(fields, "content", content, 1, maxReportChars)
		if len(fields) > 0 {
			return domain.Validation(fields)
		}
		return q.UpdateReportText(ctx, id, *in.Version, title, content)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

// Approve locks a fresh draft. Approving an approved report returns it unchanged.
func (s *Reports) Approve(ctx context.Context, userID, id, version int64, acknowledged bool) (*domain.Report, error) {
	err := s.Store.Tx(ctx, func(q sqlite.Q) error {
		r, err := q.Report(ctx, id)
		if err != nil {
			return err
		}
		if r.Status == "approved" {
			return nil
		}
		if !acknowledged {
			return domain.Validation(map[string]string{"review_acknowledged": "must be true"})
		}
		if r.Version != version {
			return domain.VersionConflict()
		}
		src, err := loadSource(ctx, q, r.SessionID)
		if err != nil {
			return err
		}
		if src.hash != r.SourceHash {
			return domain.Conflict("STALE_REPORT", "Sumber temuan berubah; regenerate atau buat ulang draft sebelum menyetujui.")
		}
		if err := src.usable(); err != nil {
			return err
		}
		return q.ApproveReport(ctx, id, version, userID)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

func (s *Reports) Delete(ctx context.Context, id, version int64) error {
	return s.Store.Tx(ctx, func(q sqlite.Q) error {
		r, err := q.Report(ctx, id)
		if err != nil {
			return err
		}
		if r.Status != "draft" {
			return errLocked()
		}
		return q.SoftDeleteReport(ctx, id, version)
	})
}
