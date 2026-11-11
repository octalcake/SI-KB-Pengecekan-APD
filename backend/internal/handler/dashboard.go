package handler

import (
	"fmt"
	"net/http"
	"time"

	"k3/backend/internal/domain"
	"k3/backend/internal/httpx"
)

// dashboardFilter parses the §9.8 filter shared by summary, trends and zones.
func dashboardFilter(r *http.Request) (domain.DashboardFilter, error) {
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
	if f.Mode == "" {
		f.Mode = "real" // never mix simulated with real by default (§9.8)
	}
	return f, err
}

func (a *API) dashboardSummary(w http.ResponseWriter, r *http.Request) {
	f, err := dashboardFilter(r)
	if err == nil {
		var out *domain.DashboardSummary
		if out, err = a.Store.Q().DashboardSummary(r.Context(), f); err == nil {
			out.Timezone = a.Cfg.DisplayTimezone.String()
			httpx.Data(w, http.StatusOK, out)
			return
		}
	}
	httpx.Error(w, r, err)
}

// dashboardTrends counts confirmed findings per local day (P1, §9.8).
func (a *API) dashboardTrends(w http.ResponseWriter, r *http.Request) {
	f, err := dashboardFilter(r)
	if err == nil {
		// shortcut: one offset for the whole range, exact for Asia/Jakarta (no DST); a DST zone needs per-row conversion.
		_, off := time.Now().In(a.Cfg.DisplayTimezone).Zone()
		var out []domain.TrendPoint
		if out, err = a.Store.Q().DashboardTrends(r.Context(), f, fmt.Sprintf("%+d minutes", off/60)); err == nil {
			httpx.Data(w, http.StatusOK, out)
			return
		}
	}
	httpx.Error(w, r, err)
}

// dashboardZones counts confirmed findings per zone (P1, §9.8).
func (a *API) dashboardZones(w http.ResponseWriter, r *http.Request) {
	f, err := dashboardFilter(r)
	if err == nil {
		var out []domain.ZoneCount
		if out, err = a.Store.Q().DashboardZones(r.Context(), f); err == nil {
			httpx.Data(w, http.StatusOK, out)
			return
		}
	}
	httpx.Error(w, r, err)
}
