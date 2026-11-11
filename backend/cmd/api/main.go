package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"k3/backend/internal/aiclient"
	"k3/backend/internal/config"
	"k3/backend/internal/handler"
	"k3/backend/internal/repository/sqlite"
	"k3/backend/internal/service"
	"k3/backend/internal/storage"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fatal("invalid config", err)
	}
	db, err := sqlite.Open(cfg.DBPath)
	if err != nil {
		fatal("open db", err)
	}
	defer db.Close()
	evidence, err := storage.NewEvidence(cfg.EvidenceDir)
	if err != nil {
		fatal("evidence dir", err)
	}

	store := &sqlite.Store{DB: db}
	ai := aiclient.New(cfg.AIBaseURL, cfg.AIInternalToken)
	mon := &service.Monitoring{Store: store, AI: ai, Evidence: evidence, Cfg: cfg}
	auth := &service.Auth{Store: store, TTL: cfg.AuthTTL, Limiter: service.NewLoginLimiter(5, time.Minute), OnLogout: mon.StopForUser}
	api := &handler.API{Cfg: cfg, DB: db, Store: store, AI: ai, Auth: auth, Master: &service.Master{Store: store}, Monitoring: mon}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Sessions left active by a previous process are not resumed (SRS §6.5).
	if err := mon.Reconcile(ctx); err != nil {
		fatal("reconcile sessions", err)
	}
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				mon.Tick(now)
			}
		}
	}()

	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: api.Routes(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	slog.Info("api listening", "addr", cfg.HTTPAddr, "ai_mode", cfg.AIMode)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fatal("server", err)
	}
}

func fatal(msg string, err error) {
	slog.Error(msg, "err", err)
	os.Exit(1)
}
