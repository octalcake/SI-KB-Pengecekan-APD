package sqlite

import (
	"context"

	"k3/backend/internal/domain"
)

// DashboardSummary counts from source records (SRS §5.7, §9.8): sessions by
// started_at, findings by captured_at, soft-deleted findings ignored.
func (q Q) DashboardSummary(ctx context.Context, f domain.DashboardFilter) (*domain.DashboardSummary, error) {
	scope := `(? = 0 OR z.project_id = ?) AND (? = 0 OR s.zone_id = ?) AND s.mode = ?`
	args := []any{f.ProjectID, f.ProjectID, f.ZoneID, f.ZoneID, f.Mode}
	var out domain.DashboardSummary
	err := q.q.QueryRowContext(ctx,
		`SELECT count(*) FROM monitoring_sessions s JOIN zones z ON z.id = s.zone_id
		 WHERE `+scope+` AND (? = '' OR s.started_at >= ?) AND (? = '' OR s.started_at < ?)`,
		append(args, f.From, f.From, f.To, f.To)...).Scan(&out.Sessions)
	if err != nil {
		return nil, err
	}
	err = q.q.QueryRowContext(ctx,
		`SELECT
		   coalesce(sum(f.verification_status = 'pending'), 0),
		   coalesce(sum(f.verification_status = 'confirmed'), 0),
		   coalesce(sum(f.verification_status = 'rejected'), 0),
		   coalesce(sum(f.verification_status = 'confirmed' AND f.action_status != 'completed'), 0)
		 FROM findings f JOIN monitoring_sessions s ON s.id = f.session_id JOIN zones z ON z.id = s.zone_id
		 WHERE f.deleted_at IS NULL AND `+scope+` AND (? = '' OR f.captured_at >= ?) AND (? = '' OR f.captured_at < ?)`,
		append(args, f.From, f.From, f.To, f.To)...,
	).Scan(&out.FindingsPending, &out.FindingsConfirmed, &out.FindingsRejected, &out.ConfirmedActionsOpen)
	if err != nil {
		return nil, err
	}
	out.CountUnit, out.Mode = "finding", f.Mode
	return &out, nil
}
