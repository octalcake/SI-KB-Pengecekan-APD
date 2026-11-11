package service

import (
	"context"
	"strings"
	"unicode/utf8"

	"k3/backend/internal/domain"
	"k3/backend/internal/repository/sqlite"
)

// Master implements the project/zone rules of SRS §5.2–5.3. Mutations run in a
// writer transaction so they cannot slip between other checks and commits.
type Master struct{ Store *sqlite.Store }

type ProjectInput struct {
	Name        *string `json:"name"`
	Location    *string `json:"location"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	Version     *int64  `json:"version"`
}

type ZoneInput struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	Version     *int64  `json:"version"`
}

func checkLen(fields map[string]string, key, v string, min, max int) {
	n := utf8.RuneCountInString(v)
	switch {
	case n < min:
		fields[key] = "required"
	case n > max:
		fields[key] = "too_long"
	}
}

func checkStatus(fields map[string]string, s *string) {
	if s != nil && *s != domain.StatusActive && *s != domain.StatusArchived {
		fields["status"] = "invalid"
	}
}

func str(p *string, def string) string {
	if p == nil {
		return def
	}
	return strings.TrimSpace(*p)
}

func (m *Master) CreateProject(ctx context.Context, in ProjectInput) (*domain.Project, error) {
	p := &domain.Project{Name: str(in.Name, ""), Location: str(in.Location, ""), Description: str(in.Description, "")}
	f := map[string]string{}
	checkLen(f, "name", p.Name, 1, 120)
	checkLen(f, "location", p.Location, 0, 200)
	checkLen(f, "description", p.Description, 0, 2000)
	if in.Status != nil || in.Version != nil {
		f["status"] = "not_allowed_on_create"
	}
	if len(f) > 0 {
		return nil, domain.Validation(f)
	}
	return m.Store.Q().CreateProject(ctx, p)
}

func (m *Master) UpdateProject(ctx context.Context, id int64, in ProjectInput) (*domain.Project, error) {
	if in.Version == nil {
		return nil, domain.Validation(map[string]string{"version": "required"})
	}
	var out *domain.Project
	err := m.Store.Tx(ctx, func(q sqlite.Q) error {
		p, err := q.Project(ctx, id)
		if err != nil {
			return err
		}
		if p.Version != *in.Version {
			return domain.VersionConflict()
		}
		p.Name, p.Location, p.Description = str(in.Name, p.Name), str(in.Location, p.Location), str(in.Description, p.Description)
		f := map[string]string{}
		checkLen(f, "name", p.Name, 1, 120)
		checkLen(f, "location", p.Location, 0, 200)
		checkLen(f, "description", p.Description, 0, 2000)
		checkStatus(f, in.Status)
		if len(f) > 0 {
			return domain.Validation(f)
		}
		if in.Status != nil && *in.Status == domain.StatusArchived && p.Status != domain.StatusArchived {
			if active, err := q.ActiveSessionInProject(ctx, id); err != nil || active {
				return orErr(err, sessionActive())
			}
		}
		p.Status = str(in.Status, p.Status)
		if err := q.UpdateProject(ctx, p); err != nil {
			return err
		}
		out, err = q.Project(ctx, id)
		return err
	})
	return out, err
}

func (m *Master) DeleteProject(ctx context.Context, id, version int64) error {
	return m.Store.Tx(ctx, func(q sqlite.Q) error {
		if _, err := q.Project(ctx, id); err != nil {
			return err
		}
		if used, err := q.ProjectHasZones(ctx, id); err != nil || used {
			return orErr(err, domain.Conflict("PROJECT_IN_USE", "Proyek masih memiliki zona. Arsipkan proyek sebagai gantinya."))
		}
		return q.DeleteProject(ctx, id, version)
	})
}

func (m *Master) CreateZone(ctx context.Context, projectID int64, in ZoneInput) (*domain.Zone, error) {
	z := &domain.Zone{ProjectID: projectID, Name: str(in.Name, ""), Description: str(in.Description, "")}
	f := map[string]string{}
	checkLen(f, "name", z.Name, 1, 120)
	checkLen(f, "description", z.Description, 0, 2000)
	if in.Status != nil || in.Version != nil {
		f["status"] = "not_allowed_on_create"
	}
	if len(f) > 0 {
		return nil, domain.Validation(f)
	}
	var out *domain.Zone
	err := m.Store.Tx(ctx, func(q sqlite.Q) error {
		p, err := q.Project(ctx, projectID)
		if err != nil {
			return err
		}
		if p.Status != domain.StatusActive {
			return domain.NewError(422, "PROJECT_NOT_ACTIVE", "Zona hanya dapat dibuat pada proyek aktif.")
		}
		out, err = q.CreateZone(ctx, z)
		return err
	})
	return out, err
}

func (m *Master) UpdateZone(ctx context.Context, id int64, in ZoneInput) (*domain.Zone, error) {
	if in.Version == nil {
		return nil, domain.Validation(map[string]string{"version": "required"})
	}
	var out *domain.Zone
	err := m.Store.Tx(ctx, func(q sqlite.Q) error {
		z, err := q.Zone(ctx, id)
		if err != nil {
			return err
		}
		if z.Version != *in.Version {
			return domain.VersionConflict()
		}
		z.Name, z.Description = str(in.Name, z.Name), str(in.Description, z.Description)
		f := map[string]string{}
		checkLen(f, "name", z.Name, 1, 120)
		checkLen(f, "description", z.Description, 0, 2000)
		checkStatus(f, in.Status)
		if len(f) > 0 {
			return domain.Validation(f)
		}
		if in.Status != nil && *in.Status == domain.StatusArchived && z.Status != domain.StatusArchived {
			if active, err := q.ActiveSessionInZone(ctx, id); err != nil || active {
				return orErr(err, sessionActive())
			}
		}
		z.Status = str(in.Status, z.Status)
		if err := q.UpdateZone(ctx, z); err != nil {
			return err
		}
		out, err = q.Zone(ctx, id)
		return err
	})
	return out, err
}

func (m *Master) DeleteZone(ctx context.Context, id, version int64) error {
	return m.Store.Tx(ctx, func(q sqlite.Q) error {
		if _, err := q.Zone(ctx, id); err != nil {
			return err
		}
		if used, err := q.ZoneHasSessions(ctx, id); err != nil || used {
			return orErr(err, domain.Conflict("ZONE_IN_USE", "Zona sudah dipakai sesi monitoring. Arsipkan zona sebagai gantinya."))
		}
		return q.DeleteZone(ctx, id, version)
	})
}

func sessionActive() error {
	return domain.Conflict("SESSION_ACTIVE", "Tidak dapat diarsipkan saat sesi monitoring aktif.")
}

func orErr(err, fallback error) error {
	if err != nil {
		return err
	}
	return fallback
}
