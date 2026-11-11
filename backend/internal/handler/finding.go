package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"k3/backend/internal/domain"
	"k3/backend/internal/httpx"
	"k3/backend/internal/service"
)

// timeParam parses a from/to filter; it must carry an offset or Z (SRS §9.1).
func timeParam(r *http.Request, key string) (string, error) {
	v := r.URL.Query().Get(key)
	if v == "" {
		return "", nil
	}
	t, err := time.Parse(time.RFC3339Nano, v)
	if err != nil {
		return "", domain.BadRequest(key + " wajib RFC3339 dengan offset/Z.")
	}
	return t.UTC().Format(domain.TimeFormat), nil
}

func oneOf(r *http.Request, key string, allowed ...string) (string, error) {
	v := r.URL.Query().Get(key)
	if v == "" {
		return "", nil
	}
	for _, a := range allowed {
		if v == a {
			return v, nil
		}
	}
	return "", domain.BadRequest(key + " tidak valid.")
}

func (a *API) listFindings(w http.ResponseWriter, r *http.Request) {
	var f domain.FindingFilter
	var err error
	steps := []func() error{
		func() (e error) { f.Page, f.PageSize, e = paging(r); return },
		func() (e error) { f.ProjectID, e = queryInt(r, "project_id"); return },
		func() (e error) { f.ZoneID, e = queryInt(r, "zone_id"); return },
		func() (e error) { f.SessionID, e = queryInt(r, "session_id"); return },
		func() (e error) { f.ViolationType, e = oneOf(r, "violation_type", "NO_HELMET", "NO_VEST"); return },
		func() (e error) {
			f.VerificationStatus, e = oneOf(r, "verification_status", "pending", "confirmed", "rejected")
			return
		},
		func() (e error) {
			f.ActionStatus, e = oneOf(r, "action_status", "pending", "in_progress", "completed")
			return
		},
		func() (e error) { f.From, e = timeParam(r, "from"); return },
		func() (e error) { f.To, e = timeParam(r, "to"); return },
		func() error {
			sort, e := oneOf(r, "sort", "id", "captured_at")
			f.SortCapturedAt = sort == "captured_at"
			return e
		},
	}
	for _, step := range steps {
		if err = step(); err != nil {
			httpx.Error(w, r, err)
			return
		}
	}
	items, total, err := a.Store.Q().ListFindings(r.Context(), f)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.List(w, items, domain.Page{Page: f.Page, PageSize: f.PageSize, Total: total})
}

func (a *API) getFinding(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err == nil {
		var f *domain.Finding
		if f, err = a.Store.Q().Finding(r.Context(), id); err == nil {
			httpx.Data(w, http.StatusOK, f)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) reviewFinding(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var in service.ReviewInput
	if err == nil {
		err = decode(w, r, &in)
	}
	if err == nil {
		var f *domain.Finding
		if f, err = a.Findings.Review(r.Context(), httpx.User(r.Context()).ID, id, in); err == nil {
			httpx.Data(w, http.StatusOK, f)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) deleteFinding(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var v int64
	if err == nil {
		v, err = requiredVersion(r)
	}
	if err == nil {
		if err = a.Findings.Delete(r.Context(), id, v); err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	httpx.Error(w, r, err)
}

// createManualFinding accepts the §9.6 multipart form (fallback only).
func (a *API) createManualFinding(w http.ResponseWriter, r *http.Request) {
	if !a.Cfg.AllowManualFallback {
		httpx.Error(w, r, domain.Forbidden("MANUAL_FALLBACK_DISABLED", "Temuan manual tidak diaktifkan."))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, int64(a.Cfg.FrameMaxBytes)+64<<10)
	if err := r.ParseMultipartForm(int64(a.Cfg.FrameMaxBytes) + 64<<10); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			httpx.Error(w, r, domain.NewError(http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Foto melebihi 1 MiB."))
			return
		}
		httpx.Error(w, r, domain.NewError(http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Body harus multipart/form-data."))
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, _, err := r.FormFile("evidence")
	if err != nil {
		httpx.Error(w, r, domain.Validation(map[string]string{"evidence": "required"}))
		return
	}
	defer file.Close()
	img, err := io.ReadAll(io.LimitReader(file, int64(a.Cfg.FrameMaxBytes)+1))
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	if len(img) > a.Cfg.FrameMaxBytes {
		httpx.Error(w, r, domain.NewError(http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Foto melebihi 1 MiB."))
		return
	}
	sid, _ := strconv.ParseInt(r.FormValue("session_id"), 10, 64)
	f, err := a.Findings.CreateManual(r.Context(), service.ManualInput{
		SessionID: sid, ViolationType: r.FormValue("violation_type"), Notes: r.FormValue("notes"), JPEG: img,
	})
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Data(w, http.StatusCreated, f)
}
