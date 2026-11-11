package sqlite

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"

	"k3/backend/internal/domain"
)

const findingCols = `f.id, f.session_id, z.project_id, s.zone_id, f.source, s.mode, f.track_id, f.track_key,
	f.detected_violation, f.violation_type, f.confidence, f.person_bbox_json, f.violation_bbox_json,
	f.raw_detection_json, f.evidence_sha256, f.frame_sequence, f.frame_width, f.frame_height, f.model_version,
	f.captured_at, f.received_at, f.verification_status, f.verified_by, f.verified_at, f.notes,
	f.action_status, f.action_notes, f.version, f.created_at, f.updated_at`

const findingFrom = ` FROM findings f
	JOIN monitoring_sessions s ON s.id = f.session_id
	JOIN zones z ON z.id = s.zone_id`

func rawJSON(s *string) json.RawMessage {
	if s == nil {
		return json.RawMessage("null")
	}
	return json.RawMessage(*s)
}

func scanFinding(row interface{ Scan(...any) error }) (*domain.Finding, error) {
	var f domain.Finding
	var pb, vb, raw *string
	err := row.Scan(&f.ID, &f.SessionID, &f.ProjectID, &f.ZoneID, &f.Source, &f.Mode, &f.TrackID, &f.TrackKey,
		&f.DetectedViolation, &f.ViolationType, &f.Confidence, &pb, &vb, &raw, &f.EvidenceSHA256, &f.FrameSequence,
		&f.FrameWidth, &f.FrameHeight, &f.ModelVersion, &f.CapturedAt, &f.ReceivedAt, &f.VerificationStatus,
		&f.VerifiedBy, &f.VerifiedAt, &f.Notes, &f.ActionStatus, &f.ActionNotes, &f.Version, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return nil, err
	}
	f.PersonBBox, f.ViolationBBox, f.RawDetection = rawJSON(pb), rawJSON(vb), rawJSON(raw)
	f.EvidenceURL = fmt.Sprintf("/api/v1/findings/%d/evidence", f.ID)
	return &f, nil
}

// Finding returns a non-deleted finding.
func (q Q) Finding(ctx context.Context, id int64) (*domain.Finding, error) {
	f, err := scanFinding(q.q.QueryRowContext(ctx,
		`SELECT `+findingCols+findingFrom+` WHERE f.id = ? AND f.deleted_at IS NULL`, id))
	if err != nil {
		return nil, notFound(err)
	}
	return f, nil
}

func (q Q) ListFindings(ctx context.Context, fl domain.FindingFilter) ([]domain.Finding, int, error) {
	where := findingFrom + ` WHERE f.deleted_at IS NULL
		AND (? = 0 OR z.project_id = ?) AND (? = 0 OR s.zone_id = ?) AND (? = 0 OR f.session_id = ?)
		AND (? = '' OR f.violation_type = ?) AND (? = '' OR f.verification_status = ?)
		AND (? = '' OR f.action_status = ?) AND (? = '' OR f.captured_at >= ?) AND (? = '' OR f.captured_at < ?)`
	args := []any{fl.ProjectID, fl.ProjectID, fl.ZoneID, fl.ZoneID, fl.SessionID, fl.SessionID,
		fl.ViolationType, fl.ViolationType, fl.VerificationStatus, fl.VerificationStatus,
		fl.ActionStatus, fl.ActionStatus, fl.From, fl.From, fl.To, fl.To}
	var total int
	if err := q.q.QueryRowContext(ctx, `SELECT count(*)`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	order := ` ORDER BY f.id DESC`
	if fl.SortCapturedAt {
		order = ` ORDER BY f.captured_at DESC, f.id DESC`
	}
	rows, err := q.q.QueryContext(ctx, `SELECT `+findingCols+where+order+` LIMIT ? OFFSET ?`,
		append(args, fl.PageSize, (fl.Page-1)*fl.PageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.Finding{}
	for rows.Next() {
		f, err := scanFinding(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *f)
	}
	return out, total, rows.Err()
}

// UpdateFindingReview writes the officer-editable fields with a version check.
func (q Q) UpdateFindingReview(ctx context.Context, f *domain.Finding) error {
	res, err := q.q.ExecContext(ctx,
		`UPDATE findings SET violation_type = ?, verification_status = ?, verified_by = ?, verified_at = ?, notes = ?,
		   action_status = ?, action_notes = ?, version = version + 1, updated_at = ?
		 WHERE id = ? AND version = ? AND deleted_at IS NULL`,
		f.ViolationType, f.VerificationStatus, f.VerifiedBy, f.VerifiedAt, f.Notes,
		f.ActionStatus, f.ActionNotes, Now(), f.ID, f.Version)
	if err != nil {
		return err
	}
	return q.requireOne(ctx, res, "findings", f.ID)
}

func (q Q) SoftDeleteFinding(ctx context.Context, id, version int64) error {
	now := Now()
	res, err := q.q.ExecContext(ctx,
		`UPDATE findings SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND deleted_at IS NULL`,
		now, now, id, version)
	if err != nil {
		return err
	}
	return q.requireOne(ctx, res, "findings", id)
}

type ManualFinding struct {
	SessionID      int64
	ViolationType  string
	Notes          string
	FrameWidth     int
	FrameHeight    int
	EvidencePath   string
	EvidenceSHA256 string
}

func (q Q) InsertManualFinding(ctx context.Context, m *ManualFinding) (int64, error) {
	now := Now()
	res, err := q.q.ExecContext(ctx,
		`INSERT INTO findings (session_id, source, violation_type, frame_width, frame_height, evidence_path,
		   evidence_sha256, captured_at, received_at, notes, created_at, updated_at)
		 VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.SessionID, m.ViolationType, m.FrameWidth, m.FrameHeight, m.EvidencePath, m.EvidenceSHA256, now, now, m.Notes, now, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ConfirmedForSnapshot is the §11.4 query: confirmed, non-deleted, ordered by id.
func (q Q) ConfirmedForSnapshot(ctx context.Context, sessionID int64) ([]domain.SnapshotFinding, error) {
	rows, err := q.q.QueryContext(ctx,
		`SELECT f.id, f.version, f.violation_type, f.captured_at, f.notes, f.action_status, f.action_notes
		 FROM findings AS f
		 WHERE f.session_id = ? AND f.verification_status = 'confirmed' AND f.deleted_at IS NULL
		 ORDER BY f.id ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.SnapshotFinding{}
	for rows.Next() {
		var f domain.SnapshotFinding
		if err := rows.Scan(&f.ID, &f.Version, &f.ViolationType, &f.CapturedAt, &f.Notes, &f.ActionStatus, &f.ActionNotes); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// LockedByApprovedReport reports whether the finding is a source of an approved report (BR-08).
func (q Q) LockedByApprovedReport(ctx context.Context, sessionID, findingID int64) (bool, error) {
	rows, err := q.q.QueryContext(ctx,
		`SELECT findings_snapshot_json FROM reports WHERE session_id = ? AND status = 'approved'`, sessionID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return false, err
		}
		var snap domain.Snapshot
		if err := json.Unmarshal([]byte(raw), &snap); err != nil {
			return false, err
		}
		if slices.ContainsFunc(snap.Findings, func(f domain.SnapshotFinding) bool { return f.ID == findingID }) {
			return true, nil
		}
	}
	return false, rows.Err()
}
