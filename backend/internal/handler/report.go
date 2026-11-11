package handler

import (
	"net/http"

	"k3/backend/internal/domain"
	"k3/backend/internal/httpx"
	"k3/backend/internal/service"
)

func (a *API) generateReport(w http.ResponseWriter, r *http.Request) {
	var in struct {
		SessionID  int64  `json:"session_id"`
		RequestKey string `json:"request_key"`
	}
	err := decode(w, r, &in)
	if err == nil {
		var rep *domain.Report
		if rep, err = a.Reports.Generate(r.Context(), httpx.User(r.Context()).ID, in.SessionID, in.RequestKey); err == nil {
			httpx.Data(w, http.StatusCreated, rep)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) createReport(w http.ResponseWriter, r *http.Request) {
	var in service.ManualReportInput
	err := decode(w, r, &in)
	if err == nil {
		var rep *domain.Report
		if rep, err = a.Reports.CreateManual(r.Context(), httpx.User(r.Context()).ID, in); err == nil {
			httpx.Data(w, http.StatusCreated, rep)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) listReports(w http.ResponseWriter, r *http.Request) {
	page, size, err := paging(r)
	var projectID, sessionID int64
	var status string
	if err == nil {
		projectID, err = queryInt(r, "project_id")
	}
	if err == nil {
		sessionID, err = queryInt(r, "session_id")
	}
	if err == nil {
		status, err = statusFilter(r, "draft", "approved")
	}
	if err == nil {
		var items []domain.Report
		var total int
		if items, total, err = a.Reports.List(r.Context(), projectID, sessionID, status, page, size); err == nil {
			httpx.List(w, items, domain.Page{Page: page, PageSize: size, Total: total})
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) getReport(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err == nil {
		var rep *domain.Report
		if rep, err = a.Reports.Get(r.Context(), id); err == nil {
			httpx.Data(w, http.StatusOK, rep)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) updateReport(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var in service.ReportEditInput
	if err == nil {
		err = decode(w, r, &in)
	}
	if err == nil {
		var rep *domain.Report
		if rep, err = a.Reports.Update(r.Context(), id, in); err == nil {
			httpx.Data(w, http.StatusOK, rep)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) regenerateReport(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var in struct {
		Version    *int64 `json:"version"`
		RequestKey string `json:"request_key"`
	}
	if err == nil {
		err = decode(w, r, &in)
	}
	if err == nil && in.Version == nil {
		err = domain.Validation(map[string]string{"version": "required"})
	}
	if err == nil {
		var rep *domain.Report
		if rep, err = a.Reports.Regenerate(r.Context(), id, *in.Version, in.RequestKey); err == nil {
			httpx.Data(w, http.StatusOK, rep)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) approveReport(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var in struct {
		Version            *int64 `json:"version"`
		ReviewAcknowledged bool   `json:"review_acknowledged"`
	}
	if err == nil {
		err = decode(w, r, &in)
	}
	if err == nil && in.Version == nil {
		err = domain.Validation(map[string]string{"version": "required"})
	}
	if err == nil {
		var rep *domain.Report
		if rep, err = a.Reports.Approve(r.Context(), httpx.User(r.Context()).ID, id, *in.Version, in.ReviewAcknowledged); err == nil {
			httpx.Data(w, http.StatusOK, rep)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) deleteReport(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var v int64
	if err == nil {
		v, err = requiredVersion(r)
	}
	if err == nil {
		if err = a.Reports.Delete(r.Context(), id, v); err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) dashboardSummary(w http.ResponseWriter, r *http.Request) {
	var f domain.DashboardFilter
	var err error
	f.ProjectID, err = queryInt(r, "project_id")
	if err == nil {
		f.ZoneID, err = queryInt(r, "zone_id")
	}
	if err == nil {
		f.From, err = timeParam(r, "from")
	}
	if err == nil {
		f.To, err = timeParam(r, "to")
	}
	if err == nil {
		f.Mode, err = oneOf(r, "mode", "real", "simulated", "manual")
	}
	if err == nil {
		if f.Mode == "" {
			f.Mode = "real" // never mix simulated with real by default (§9.8)
		}
		var out *domain.DashboardSummary
		if out, err = a.Store.Q().DashboardSummary(r.Context(), f); err == nil {
			out.Timezone = a.Cfg.DisplayTimezone.String()
			httpx.Data(w, http.StatusOK, out)
			return
		}
	}
	httpx.Error(w, r, err)
}
