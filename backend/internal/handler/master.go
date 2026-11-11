package handler

import (
	"net/http"

	"k3/backend/internal/domain"
	"k3/backend/internal/httpx"
	"k3/backend/internal/service"
)

func (a *API) createProject(w http.ResponseWriter, r *http.Request) {
	var in service.ProjectInput
	if err := decode(w, r, &in); err != nil {
		httpx.Error(w, r, err)
		return
	}
	p, err := a.Master.CreateProject(r.Context(), in)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Data(w, http.StatusCreated, p)
}

func (a *API) listProjects(w http.ResponseWriter, r *http.Request) {
	page, size, err := paging(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	status, err := statusFilter(r, domain.StatusActive, domain.StatusArchived)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	items, total, err := a.Store.Q().ListProjects(r.Context(), r.URL.Query().Get("q"), status, page, size)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.List(w, items, domain.Page{Page: page, PageSize: size, Total: total})
}

func (a *API) getProject(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err == nil {
		var p *domain.Project
		if p, err = a.Store.Q().Project(r.Context(), id); err == nil {
			httpx.Data(w, http.StatusOK, p)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) updateProject(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var in service.ProjectInput
	if err == nil {
		err = decode(w, r, &in)
	}
	if err == nil {
		var p *domain.Project
		if p, err = a.Master.UpdateProject(r.Context(), id, in); err == nil {
			httpx.Data(w, http.StatusOK, p)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) deleteProject(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var v int64
	if err == nil {
		v, err = requiredVersion(r)
	}
	if err == nil {
		if err = a.Master.DeleteProject(r.Context(), id, v); err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) createZone(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var in service.ZoneInput
	if err == nil {
		err = decode(w, r, &in)
	}
	if err == nil {
		var z *domain.Zone
		if z, err = a.Master.CreateZone(r.Context(), id, in); err == nil {
			httpx.Data(w, http.StatusCreated, z)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) listZones(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	if _, err := a.Store.Q().Project(r.Context(), id); err != nil {
		httpx.Error(w, r, err)
		return
	}
	page, size, err := paging(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	status, err := statusFilter(r, domain.StatusActive, domain.StatusArchived)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	items, total, err := a.Store.Q().ListZones(r.Context(), id, status, page, size)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.List(w, items, domain.Page{Page: page, PageSize: size, Total: total})
}

func (a *API) getZone(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err == nil {
		var z *domain.Zone
		if z, err = a.Store.Q().Zone(r.Context(), id); err == nil {
			httpx.Data(w, http.StatusOK, z)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) updateZone(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var in service.ZoneInput
	if err == nil {
		err = decode(w, r, &in)
	}
	if err == nil {
		var z *domain.Zone
		if z, err = a.Master.UpdateZone(r.Context(), id, in); err == nil {
			httpx.Data(w, http.StatusOK, z)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) deleteZone(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var v int64
	if err == nil {
		v, err = requiredVersion(r)
	}
	if err == nil {
		if err = a.Master.DeleteZone(r.Context(), id, v); err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	httpx.Error(w, r, err)
}
