package sqlite

import (
	"context"
	"database/sql"

	"k3/backend/internal/domain"
)

const projectCols = `id, name, location, description, status, version, created_at, updated_at`

func scanProject(row interface{ Scan(...any) error }) (*domain.Project, error) {
	var p domain.Project
	err := row.Scan(&p.ID, &p.Name, &p.Location, &p.Description, &p.Status, &p.Version, &p.CreatedAt, &p.UpdatedAt)
	return &p, err
}

func (q Q) CreateProject(ctx context.Context, p *domain.Project) (*domain.Project, error) {
	now := Now()
	res, err := q.q.ExecContext(ctx,
		`INSERT INTO projects (name, location, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		p.Name, p.Location, p.Description, now, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return q.Project(ctx, id)
}

func (q Q) Project(ctx context.Context, id int64) (*domain.Project, error) {
	p, err := scanProject(q.q.QueryRowContext(ctx, `SELECT `+projectCols+` FROM projects WHERE id = ?`, id))
	if err != nil {
		return nil, notFound(err)
	}
	return p, nil
}

func (q Q) ListProjects(ctx context.Context, search, status string, page, size int) ([]domain.Project, int, error) {
	where := ` FROM projects WHERE (? = '' OR name LIKE '%' || ? || '%') AND (? = '' OR status = ?)`
	args := []any{search, search, status, status}
	var total int
	if err := q.q.QueryRowContext(ctx, `SELECT count(*)`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.q.QueryContext(ctx, `SELECT `+projectCols+where+` ORDER BY id DESC LIMIT ? OFFSET ?`,
		append(args, size, (page-1)*size)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *p)
	}
	return out, total, rows.Err()
}

func (q Q) UpdateProject(ctx context.Context, p *domain.Project) error {
	res, err := q.q.ExecContext(ctx,
		`UPDATE projects SET name = ?, location = ?, description = ?, status = ?, version = version + 1, updated_at = ?
		 WHERE id = ? AND version = ?`,
		p.Name, p.Location, p.Description, p.Status, Now(), p.ID, p.Version)
	if err != nil {
		return err
	}
	return q.requireOne(ctx, res, "projects", p.ID)
}

func (q Q) DeleteProject(ctx context.Context, id, version int64) error {
	res, err := q.q.ExecContext(ctx, `DELETE FROM projects WHERE id = ? AND version = ?`, id, version)
	if err != nil {
		return err
	}
	return q.requireOne(ctx, res, "projects", id)
}

func (q Q) ProjectHasZones(ctx context.Context, id int64) (bool, error) {
	return q.exists(ctx, `SELECT 1 FROM zones WHERE project_id = ? LIMIT 1`, id)
}

// ActiveSessionInProject / InZone back the "no archive while monitoring" rule.
func (q Q) ActiveSessionInProject(ctx context.Context, projectID int64) (bool, error) {
	return q.exists(ctx, `SELECT 1 FROM monitoring_sessions s JOIN zones z ON z.id = s.zone_id
		WHERE z.project_id = ? AND s.status = 'active' LIMIT 1`, projectID)
}

func (q Q) ActiveSessionInZone(ctx context.Context, zoneID int64) (bool, error) {
	return q.exists(ctx, `SELECT 1 FROM monitoring_sessions WHERE zone_id = ? AND status = 'active' LIMIT 1`, zoneID)
}

func (q Q) ZoneHasSessions(ctx context.Context, zoneID int64) (bool, error) {
	return q.exists(ctx, `SELECT 1 FROM monitoring_sessions WHERE zone_id = ? LIMIT 1`, zoneID)
}

func (q Q) exists(ctx context.Context, query string, args ...any) (bool, error) {
	var one int
	err := q.q.QueryRowContext(ctx, query, args...).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

const zoneCols = `id, project_id, name, description, status, version, created_at, updated_at`

func scanZone(row interface{ Scan(...any) error }) (*domain.Zone, error) {
	var z domain.Zone
	err := row.Scan(&z.ID, &z.ProjectID, &z.Name, &z.Description, &z.Status, &z.Version, &z.CreatedAt, &z.UpdatedAt)
	return &z, err
}

func (q Q) CreateZone(ctx context.Context, z *domain.Zone) (*domain.Zone, error) {
	now := Now()
	res, err := q.q.ExecContext(ctx,
		`INSERT INTO zones (project_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		z.ProjectID, z.Name, z.Description, now, now)
	if isUnique(err) {
		return nil, duplicateZone()
	}
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return q.Zone(ctx, id)
}

func duplicateZone() error {
	return domain.Conflict("DUPLICATE_NAME", "Nama zona sudah dipakai pada proyek ini.")
}

func (q Q) Zone(ctx context.Context, id int64) (*domain.Zone, error) {
	z, err := scanZone(q.q.QueryRowContext(ctx, `SELECT `+zoneCols+` FROM zones WHERE id = ?`, id))
	if err != nil {
		return nil, notFound(err)
	}
	return z, nil
}

func (q Q) ListZones(ctx context.Context, projectID int64, status string, page, size int) ([]domain.Zone, int, error) {
	where := ` FROM zones WHERE project_id = ? AND (? = '' OR status = ?)`
	args := []any{projectID, status, status}
	var total int
	if err := q.q.QueryRowContext(ctx, `SELECT count(*)`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.q.QueryContext(ctx, `SELECT `+zoneCols+where+` ORDER BY id DESC LIMIT ? OFFSET ?`,
		append(args, size, (page-1)*size)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.Zone{}
	for rows.Next() {
		z, err := scanZone(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *z)
	}
	return out, total, rows.Err()
}

func (q Q) UpdateZone(ctx context.Context, z *domain.Zone) error {
	res, err := q.q.ExecContext(ctx,
		`UPDATE zones SET name = ?, description = ?, status = ?, version = version + 1, updated_at = ?
		 WHERE id = ? AND version = ?`,
		z.Name, z.Description, z.Status, Now(), z.ID, z.Version)
	if isUnique(err) {
		return duplicateZone()
	}
	if err != nil {
		return err
	}
	return q.requireOne(ctx, res, "zones", z.ID)
}

func (q Q) DeleteZone(ctx context.Context, id, version int64) error {
	res, err := q.q.ExecContext(ctx, `DELETE FROM zones WHERE id = ? AND version = ?`, id, version)
	if err != nil {
		return err
	}
	return q.requireOne(ctx, res, "zones", id)
}
