package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"time"

	"k3/backend/internal/aiclient"
	"k3/backend/internal/config"
	"k3/backend/internal/domain"
	"k3/backend/internal/httpx"
	"k3/backend/internal/middleware"
	"k3/backend/internal/repository/sqlite"
	"k3/backend/internal/service"
)

const maxJSONBytes = 64 << 10

type API struct {
	Cfg        *config.Config
	DB         *sql.DB
	Store      *sqlite.Store
	AI         aiclient.Client
	Auth       *service.Auth
	Master     *service.Master
	Monitoring *service.Monitoring
	Findings   *service.Findings
	Reports    *service.Reports
}

// Routes builds the /api/v1 mux with the §7.2 middleware chain.
func (a *API) Routes() http.Handler {
	authn := &middleware.Authenticator{Auth: a.Auth, CookieName: a.Cfg.AuthCookieName}
	req := authn.Require
	mux := http.NewServeMux()
	h := func(pattern string, fn http.HandlerFunc) { mux.HandleFunc(pattern, fn) }

	h("GET /api/v1/health", Health(a.DB))
	h("POST /api/v1/auth/login", a.login)
	h("GET /api/v1/auth/me", req(a.me))
	h("POST /api/v1/auth/logout", req(a.logout))
	h("GET /api/v1/system/status", req(a.systemStatus))

	h("POST /api/v1/projects", req(a.createProject))
	h("GET /api/v1/projects", req(a.listProjects))
	h("GET /api/v1/projects/{id}", req(a.getProject))
	h("PATCH /api/v1/projects/{id}", req(a.updateProject))
	h("DELETE /api/v1/projects/{id}", req(a.deleteProject))
	h("POST /api/v1/projects/{id}/zones", req(a.createZone))
	h("GET /api/v1/projects/{id}/zones", req(a.listZones))
	h("GET /api/v1/zones/{id}", req(a.getZone))
	h("PATCH /api/v1/zones/{id}", req(a.updateZone))
	h("DELETE /api/v1/zones/{id}", req(a.deleteZone))

	h("POST /api/v1/monitoring/sessions", req(a.startSession))
	h("GET /api/v1/monitoring/sessions", req(a.listSessions))
	h("GET /api/v1/monitoring/sessions/{id}", req(a.getSession))
	h("POST /api/v1/monitoring/sessions/{id}/frames", req(a.frame))
	h("POST /api/v1/monitoring/sessions/{id}/stop", req(a.stopSession))
	h("GET /api/v1/findings/{id}/evidence", req(a.evidence))
	h("GET /api/v1/findings", req(a.listFindings))
	h("POST /api/v1/findings", req(a.createManualFinding))
	h("GET /api/v1/findings/{id}", req(a.getFinding))
	h("PATCH /api/v1/findings/{id}", req(a.reviewFinding))
	h("DELETE /api/v1/findings/{id}", req(a.deleteFinding))

	h("POST /api/v1/reports/generate", req(a.generateReport))
	h("POST /api/v1/reports", req(a.createReport))
	h("GET /api/v1/reports", req(a.listReports))
	h("GET /api/v1/reports/{id}", req(a.getReport))
	h("PATCH /api/v1/reports/{id}", req(a.updateReport))
	h("DELETE /api/v1/reports/{id}", req(a.deleteReport))
	h("POST /api/v1/reports/{id}/regenerate", req(a.regenerateReport))
	h("POST /api/v1/reports/{id}/approve", req(a.approveReport))

	h("GET /api/v1/dashboard/summary", req(a.dashboardSummary))
	h("GET /api/v1/dashboard/trends", req(a.dashboardTrends))
	h("GET /api/v1/dashboard/zones", req(a.dashboardZones))

	h("/", func(w http.ResponseWriter, r *http.Request) { httpx.Error(w, r, domain.NotFound()) })

	return middleware.Base(middleware.Origin(a.Cfg.AllowedHosts, a.Cfg.AllowedOrigins)(mux))
}

// decode reads a single JSON object, rejecting unknown fields (§7.2 DTO allowlist).
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		return domain.NewError(http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Content-Type harus application/json.")
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return domain.NewError(http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Body terlalu besar.")
		}
		return domain.BadRequest("JSON tidak valid: " + err.Error())
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		return domain.BadRequest("Body harus berisi satu objek JSON.")
	}
	return nil
}

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, domain.NotFound()
	}
	return id, nil
}

func queryInt(r *http.Request, key string) (int64, error) {
	v := r.URL.Query().Get(key)
	if v == "" {
		return 0, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		return 0, domain.BadRequest(key + " harus bilangan bulat positif.")
	}
	return n, nil
}

func requiredVersion(r *http.Request) (int64, error) {
	v, err := queryInt(r, "version")
	if err == nil && v == 0 {
		err = domain.Validation(map[string]string{"version": "required"})
	}
	return v, err
}

func paging(r *http.Request) (int, int, error) {
	page, err := queryInt(r, "page")
	if err != nil {
		return 0, 0, err
	}
	size, err := queryInt(r, "page_size")
	if err != nil {
		return 0, 0, err
	}
	if page == 0 {
		page = 1
	}
	if size == 0 {
		size = 20
	}
	if size > 100 {
		return 0, 0, domain.BadRequest("page_size maksimal 100.")
	}
	return int(page), int(size), nil
}

func statusFilter(r *http.Request, allowed ...string) (string, error) {
	s := r.URL.Query().Get("status")
	if s == "" {
		return "", nil
	}
	for _, a := range allowed {
		if s == a {
			return s, nil
		}
	}
	return "", domain.BadRequest("status tidak valid.")
}

func (a *API) systemStatus(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	out := map[string]any{
		"mode":                 a.Cfg.AIMode,
		"ai_reachable":         false,
		"ai_ready":             false,
		"model_version":        nil,
		"supported_violations": []string{},
		"gemini_configured":    a.Cfg.GeminiEnabled && a.Cfg.GeminiAPIKey != "",
	}
	if a.Cfg.AIMode == domain.ModeManual {
		out["ai_ready"] = true // manual mode needs no model
	} else if mi, err := a.AI.ModelInfo(ctx); err == nil {
		out["ai_reachable"] = true
		out["ai_ready"] = mi.Ready && mi.Mode == a.Cfg.AIMode
		out["model_version"] = mi.ModelVersion
		if mi.SupportedViolations != nil {
			out["supported_violations"] = mi.SupportedViolations
		}
	}
	httpx.Data(w, http.StatusOK, out)
}
