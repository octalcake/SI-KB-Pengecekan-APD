package sqlite

import (
	"context"
	"encoding/json"

	"k3/backend/internal/domain"
)

const sessionCols = `s.id, s.session_key, z.project_id, s.zone_id, s.started_by, s.source, s.status, s.mode,
	s.model_version, s.engine_instance_id, s.config_json, s.started_at, s.ended_at, s.end_reason, s.last_frame_at`

func scanSession(row interface{ Scan(...any) error }) (*domain.Session, error) {
	var s domain.Session
	var cfg string
	err := row.Scan(&s.ID, &s.SessionKey, &s.ProjectID, &s.ZoneID, &s.StartedBy, &s.Source, &s.Status, &s.Mode,
		&s.ModelVersion, &s.EngineInstanceID, &cfg, &s.StartedAt, &s.EndedAt, &s.EndReason, &s.LastFrameAt)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(cfg), &s.Config); err != nil {
		return nil, err
	}
	s.SupportedViolations = s.Config.SupportedViolations
	if s.SupportedViolations == nil {
		s.SupportedViolations = []string{}
	}
	return &s, nil
}

// CreateSession inserts the session; the partial unique index enforces one active camera.
func (q Q) CreateSession(ctx context.Context, s *domain.Session) (*domain.Session, error) {
	cfg, err := json.Marshal(s.Config)
	if err != nil {
		return nil, err
	}
	res, err := q.q.ExecContext(ctx,
		`INSERT INTO monitoring_sessions (session_key, zone_id, started_by, source, mode, status, model_version,
		   engine_instance_id, config_json, started_at, ended_at, end_reason)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.SessionKey, s.ZoneID, s.StartedBy, s.Source, s.Mode, s.Status, s.ModelVersion,
		s.EngineInstanceID, string(cfg), s.StartedAt, s.EndedAt, s.EndReason)
	if isUnique(err) {
		return nil, domain.Conflict("CAMERA_BUSY", "Sudah ada sesi monitoring aktif.")
	}
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return q.Session(ctx, id)
}

func (q Q) Session(ctx context.Context, id int64) (*domain.Session, error) {
	s, err := scanSession(q.q.QueryRowContext(ctx,
		`SELECT `+sessionCols+` FROM monitoring_sessions s JOIN zones z ON z.id = s.zone_id WHERE s.id = ?`, id))
	if err != nil {
		return nil, notFound(err)
	}
	return s, nil
}

func (q Q) ListSessions(ctx context.Context, projectID, zoneID int64, status string, page, size int) ([]domain.Session, int, error) {
	where := ` FROM monitoring_sessions s JOIN zones z ON z.id = s.zone_id
		WHERE (? = 0 OR z.project_id = ?) AND (? = 0 OR s.zone_id = ?) AND (? = '' OR s.status = ?)`
	args := []any{projectID, projectID, zoneID, zoneID, status, status}
	var total int
	if err := q.q.QueryRowContext(ctx, `SELECT count(*)`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.q.QueryContext(ctx, `SELECT `+sessionCols+where+` ORDER BY s.id DESC LIMIT ? OFFSET ?`,
		append(args, size, (page-1)*size)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.Session{}
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *s)
	}
	return out, total, rows.Err()
}

func (q Q) ActiveSessions(ctx context.Context) ([]domain.Session, error) {
	rows, err := q.q.QueryContext(ctx,
		`SELECT `+sessionCols+` FROM monitoring_sessions s JOIN zones z ON z.id = s.zone_id WHERE s.status = 'active'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Session
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// EndSession closes an active session; returns false if it was already closed.
func (q Q) EndSession(ctx context.Context, id int64, status, reason string) (bool, error) {
	now := Now()
	res, err := q.q.ExecContext(ctx,
		`UPDATE monitoring_sessions SET status = ?, ended_at = ?, end_reason = ? WHERE id = ? AND status = 'active'`,
		status, now, reason, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

func (q Q) TouchSession(ctx context.Context, id int64, at string) error {
	_, err := q.q.ExecContext(ctx, `UPDATE monitoring_sessions SET last_frame_at = ? WHERE id = ?`, at, id)
	return err
}

// InsertFinding stores an automatic pending finding. On the BR-03 unique
// conflict it returns the existing finding id instead.
func (q Q) InsertFinding(ctx context.Context, f *domain.NewFinding) (id int64, created bool, err error) {
	now := Now()
	res, err := q.q.ExecContext(ctx,
		`INSERT INTO findings (session_id, source, track_id, track_key, detected_violation, violation_type, confidence,
		   person_bbox_json, violation_bbox_json, raw_detection_json, model_version, frame_sequence, frame_width,
		   frame_height, evidence_path, evidence_sha256, captured_at, received_at, created_at, updated_at)
		 VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		f.SessionID, f.TrackID, f.TrackKey, f.Violation, f.Violation, f.Confidence,
		f.PersonBBoxJSON, f.ViolationBBoxJSON, f.RawDetectionJSON, f.ModelVersion, f.FrameSequence, f.FrameWidth,
		f.FrameHeight, f.EvidencePath, f.EvidenceSHA256, f.CapturedAt, f.ReceivedAt, now, now)
	if isUnique(err) {
		err = q.q.QueryRowContext(ctx,
			`SELECT id FROM findings WHERE session_id = ? AND track_key = ? AND detected_violation = ?`,
			f.SessionID, f.TrackKey, f.Violation).Scan(&id)
		return id, false, err
	}
	if err != nil {
		return 0, false, err
	}
	id, err = res.LastInsertId()
	return id, true, err
}

// FindingEvidence returns the stored relative path for a non-deleted finding.
func (q Q) FindingEvidence(ctx context.Context, id int64) (string, error) {
	var path string
	err := q.q.QueryRowContext(ctx, `SELECT evidence_path FROM findings WHERE id = ? AND deleted_at IS NULL`, id).Scan(&path)
	return path, notFound(err)
}
