package handler

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"time"

	"k3/backend/internal/domain"
	"k3/backend/internal/httpx"
	"k3/backend/internal/service"
)

func (a *API) startSession(w http.ResponseWriter, r *http.Request) {
	var in service.StartInput
	if err := decode(w, r, &in); err != nil {
		httpx.Error(w, r, err)
		return
	}
	s, err := a.Monitoring.Start(r.Context(), httpx.User(r.Context()).ID, in)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Data(w, http.StatusCreated, s)
}

func (a *API) listSessions(w http.ResponseWriter, r *http.Request) {
	page, size, err := paging(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	projectID, err := queryInt(r, "project_id")
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	zoneID, err := queryInt(r, "zone_id")
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	status, err := statusFilter(r, domain.SessionActive, domain.SessionStopped, domain.SessionInterrupted)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	items, total, err := a.Store.Q().ListSessions(r.Context(), projectID, zoneID, status, page, size)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.List(w, items, domain.Page{Page: page, PageSize: size, Total: total})
}

func (a *API) getSession(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err == nil {
		var s *domain.Session
		if s, err = a.Store.Q().Session(r.Context(), id); err == nil {
			httpx.Data(w, http.StatusOK, s)
			return
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) stopSession(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var in struct {
		Reason string `json:"reason"`
	}
	if err == nil {
		err = decode(w, r, &in)
	}
	if err == nil && in.Reason != "" && in.Reason != "user_stop" && in.Reason != "page_hidden" {
		err = domain.Validation(map[string]string{"reason": "must be user_stop or page_hidden"})
	}
	if err == nil {
		var s *domain.Session
		if s, err = a.Monitoring.Stop(r.Context(), httpx.User(r.Context()).ID, id, in.Reason); err == nil {
			httpx.Data(w, http.StatusOK, s)
			return
		}
	}
	httpx.Error(w, r, err)
}

// frame parses the §9.5 binary JPEG request; the pipeline lives in service.Monitoring.
func (a *API) frame(w http.ResponseWriter, r *http.Request) {
	receipt := time.Now() // §6.3: window anchor is the time the request arrived
	in, err := a.parseFrame(w, r)
	if err == nil {
		var id int64
		if id, err = pathID(r); err == nil {
			in.Receipt = receipt
			var res *service.FrameResult
			if res, err = a.Monitoring.Frame(r.Context(), httpx.User(r.Context()).ID, id, in); err == nil {
				httpx.Data(w, http.StatusOK, res)
				return
			}
		}
	}
	httpx.Error(w, r, err)
}

func (a *API) parseFrame(w http.ResponseWriter, r *http.Request) (service.FrameInput, error) {
	var in service.FrameInput
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "image/jpeg" {
		return in, domain.NewError(http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Content-Type harus image/jpeg.")
	}
	seq, err := strconv.ParseInt(r.Header.Get("X-Frame-Sequence"), 10, 64)
	if err != nil || seq <= 0 {
		return in, domain.BadRequest("X-Frame-Sequence wajib bilangan bulat positif.")
	}
	captured, err := time.Parse(time.RFC3339Nano, r.Header.Get("X-Captured-At"))
	if err != nil {
		return in, domain.BadRequest("X-Captured-At wajib RFC3339 dengan offset/Z.")
	}
	elapsed, err := strconv.ParseInt(r.Header.Get("X-Sample-Elapsed-Ms"), 10, 64)
	if err != nil || elapsed < 0 {
		return in, domain.BadRequest("X-Sample-Elapsed-Ms wajib bilangan bulat >= 0.")
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, int64(a.Cfg.FrameMaxBytes)))
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return in, domain.NewError(http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Frame melebihi 1 MiB.")
		}
		return in, domain.BadRequest("Gagal membaca frame.")
	}
	return service.FrameInput{Sequence: seq, CapturedAt: captured, SampleElapsedMS: elapsed, JPEG: body}, nil
}

func (a *API) evidence(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err == nil {
		var p string
		if p, err = a.Monitoring.EvidenceFile(r.Context(), id); err == nil {
			w.Header().Set("Content-Type", "image/jpeg")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			http.ServeFile(w, r, p)
			return
		}
	}
	httpx.Error(w, r, err)
}
