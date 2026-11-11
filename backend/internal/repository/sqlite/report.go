package sqlite

import (
	"context"
	"encoding/json"

	"k3/backend/internal/domain"
)

const reportCols = `r.id, r.session_id, z.project_id, r.created_by, r.title, r.content, r.status, r.generated_by,
	r.gemini_model, r.prompt_version, r.generation_request_key, r.generation_payload_hash, r.findings_snapshot_json,
	r.source_hash, r.approved_by, r.approved_at, r.version, r.created_at, r.updated_at`

const reportFrom = ` FROM reports r
	JOIN monitoring_sessions s ON s.id = r.session_id
	JOIN zones z ON z.id = s.zone_id`

func scanReport(row interface{ Scan(...any) error }) (*domain.Report, error) {
	var r domain.Report
	err := row.Scan(&r.ID, &r.SessionID, &r.ProjectID, &r.CreatedBy, &r.Title, &r.Content, &r.Status, &r.GeneratedBy,
		&r.GeminiModel, &r.PromptVersion, &r.GenerationRequestKey, &r.GenerationPayloadHash, &r.SnapshotJSON,
		&r.SourceHash, &r.ApprovedBy, &r.ApprovedAt, &r.Version, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(r.SnapshotJSON), &r.Snapshot); err != nil {
		return nil, err
	}
	r.SourceFindingIDs = []int64{}
	for _, f := range r.Snapshot.Findings {
		r.SourceFindingIDs = append(r.SourceFindingIDs, f.ID)
	}
	return &r, nil
}

func (q Q) Report(ctx context.Context, id int64) (*domain.Report, error) {
	r, err := scanReport(q.q.QueryRowContext(ctx, `SELECT `+reportCols+reportFrom+` WHERE r.id = ? AND r.deleted_at IS NULL`, id))
	if err != nil {
		return nil, notFound(err)
	}
	return r, nil
}

// ReportByRequestKey finds the non-deleted report last generated with this key.
func (q Q) ReportByRequestKey(ctx context.Context, key string) (*domain.Report, error) {
	r, err := scanReport(q.q.QueryRowContext(ctx,
		`SELECT `+reportCols+reportFrom+` WHERE r.generation_request_key = ? AND r.deleted_at IS NULL`, key))
	if err != nil {
		return nil, notFound(err)
	}
	return r, nil
}

func (q Q) ListReports(ctx context.Context, projectID, sessionID int64, status string, page, size int) ([]domain.Report, int, error) {
	where := reportFrom + ` WHERE r.deleted_at IS NULL AND (? = 0 OR z.project_id = ?) AND (? = 0 OR r.session_id = ?) AND (? = '' OR r.status = ?)`
	args := []any{projectID, projectID, sessionID, sessionID, status, status}
	var total int
	if err := q.q.QueryRowContext(ctx, `SELECT count(*)`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.q.QueryContext(ctx, `SELECT `+reportCols+where+` ORDER BY r.id DESC LIMIT ? OFFSET ?`,
		append(args, size, (page-1)*size)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.Report{}
	for rows.Next() {
		r, err := scanReport(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *r)
	}
	return out, total, rows.Err()
}

// InsertReport creates a draft; the partial unique index allows one non-deleted report per session.
func (q Q) InsertReport(ctx context.Context, r *domain.Report) (int64, error) {
	now := Now()
	res, err := q.q.ExecContext(ctx,
		`INSERT INTO reports (session_id, created_by, title, content, status, generated_by, gemini_model, prompt_version,
		   generation_request_key, generation_payload_hash, findings_snapshot_json, source_hash, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.SessionID, r.CreatedBy, r.Title, r.Content, r.GeneratedBy, r.GeminiModel, r.PromptVersion,
		r.GenerationRequestKey, r.GenerationPayloadHash, r.SnapshotJSON, r.SourceHash, now, now)
	if isUnique(err) {
		return 0, domain.Conflict("REPORT_EXISTS", "Sesi ini sudah memiliki laporan.")
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (q Q) UpdateReportText(ctx context.Context, id, version int64, title, content string) error {
	res, err := q.q.ExecContext(ctx,
		`UPDATE reports SET title = ?, content = ?, version = version + 1, updated_at = ?
		 WHERE id = ? AND version = ? AND status = 'draft' AND deleted_at IS NULL`,
		title, content, Now(), id, version)
	if err != nil {
		return err
	}
	return q.requireOne(ctx, res, "reports", id)
}

// RegenerateReport replaces narrative and source of a draft.
func (q Q) RegenerateReport(ctx context.Context, r *domain.Report) error {
	res, err := q.q.ExecContext(ctx,
		`UPDATE reports SET title = ?, content = ?, generated_by = ?, gemini_model = ?, prompt_version = ?,
		   generation_request_key = ?, generation_payload_hash = ?, findings_snapshot_json = ?, source_hash = ?,
		   version = version + 1, updated_at = ?
		 WHERE id = ? AND version = ? AND status = 'draft' AND deleted_at IS NULL`,
		r.Title, r.Content, r.GeneratedBy, r.GeminiModel, r.PromptVersion, r.GenerationRequestKey,
		r.GenerationPayloadHash, r.SnapshotJSON, r.SourceHash, Now(), r.ID, r.Version)
	if isUnique(err) {
		return domain.Conflict("IDEMPOTENCY_CONFLICT", "request_key sudah dipakai.")
	}
	if err != nil {
		return err
	}
	return q.requireOne(ctx, res, "reports", r.ID)
}

func (q Q) ApproveReport(ctx context.Context, id, version, userID int64) error {
	now := Now()
	res, err := q.q.ExecContext(ctx,
		`UPDATE reports SET status = 'approved', approved_by = ?, approved_at = ?, version = version + 1, updated_at = ?
		 WHERE id = ? AND version = ? AND status = 'draft' AND deleted_at IS NULL`,
		userID, now, now, id, version)
	if err != nil {
		return err
	}
	return q.requireOne(ctx, res, "reports", id)
}

func (q Q) SoftDeleteReport(ctx context.Context, id, version int64) error {
	now := Now()
	res, err := q.q.ExecContext(ctx,
		`UPDATE reports SET deleted_at = ?, version = version + 1, updated_at = ?
		 WHERE id = ? AND version = ? AND status = 'draft' AND deleted_at IS NULL`,
		now, now, id, version)
	if err != nil {
		return err
	}
	return q.requireOne(ctx, res, "reports", id)
}

// SnapshotHeader loads the session/project/zone part of a report snapshot.
func (q Q) SnapshotHeader(ctx context.Context, sessionID int64) (*domain.Snapshot, string, error) {
	var s domain.Snapshot
	var status string
	err := q.q.QueryRowContext(ctx,
		`SELECT s.id, s.mode, s.status, p.id, p.name, z.id, z.name
		 FROM monitoring_sessions s JOIN zones z ON z.id = s.zone_id JOIN projects p ON p.id = z.project_id
		 WHERE s.id = ?`, sessionID,
	).Scan(&s.SessionID, &s.Mode, &status, &s.Project.ID, &s.Project.Name, &s.Zone.ID, &s.Zone.Name)
	if err != nil {
		return nil, "", notFound(err)
	}
	return &s, status, nil
}
