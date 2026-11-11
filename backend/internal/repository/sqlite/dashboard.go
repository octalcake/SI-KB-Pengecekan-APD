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

const confirmedScope = ` FROM findings f JOIN monitoring_sessions s ON s.id = f.session_id JOIN zones z ON z.id = s.zone_id
	WHERE f.deleted_at IS NULL AND f.verification_status = 'confirmed'
	  AND (? = 0 OR z.project_id = ?) AND (? = 0 OR s.zone_id = ?) AND s.mode = ?
	  AND (? = '' OR f.captured_at >= ?) AND (? = '' OR f.captured_at < ?)`

func confirmedArgs(f domain.DashboardFilter) []any {
	return []any{f.ProjectID, f.ProjectID, f.ZoneID, f.ZoneID, f.Mode, f.From, f.From, f.To, f.To}
}

// DashboardTrends counts confirmed findings per local day; offset is an SQLite
// modifier such as "+420 minutes" that shifts UTC captured_at to the display zone.
func (q Q) DashboardTrends(ctx context.Context, f domain.DashboardFilter, offset string) ([]domain.TrendPoint, error) {
	rows, err := q.q.QueryContext(ctx, `SELECT date(f.captured_at, ?) d, count(*)`+confirmedScope+` GROUP BY d ORDER BY d`,
		append([]any{offset}, confirmedArgs(f)...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.TrendPoint{}
	for rows.Next() {
		var p domain.TrendPoint
		if err := rows.Scan(&p.Date, &p.CountConfirmed); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DashboardZones counts confirmed findings per zone, highest first.
func (q Q) DashboardZones(ctx context.Context, f domain.DashboardFilter) ([]domain.ZoneCount, error) {
	rows, err := q.q.QueryContext(ctx, `SELECT z.id, z.name, count(*) c`+confirmedScope+` GROUP BY z.id, z.name ORDER BY c DESC, z.name`,
		confirmedArgs(f)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ZoneCount{}
	for rows.Next() {
		var z domain.ZoneCount
		if err := rows.Scan(&z.ZoneID, &z.ZoneName, &z.CountConfirmed); err != nil {
			return nil, err
		}
		out = append(out, z)
	}
	return out, rows.Err()
}
