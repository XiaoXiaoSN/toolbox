package main

import (
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

var (
	httpPort    string
	redisClient *redis.Client
)

func init() {
	// http port
	httpPort = os.Getenv("HTTP_PORT")
	if httpPort == "" {
		httpPort = ":8000"
	}

	// redis
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "redis:6379"
	}

	redisClient = redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: os.Getenv("REDIS_PW"),
		DB:       0,
	})
}

func main() {
	r := mux.NewRouter()
	{
		r.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if _, err := io.WriteString(w, "Hello world!!"); err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}
		})

		r.HandleFunc("/marquee", marqueeStaticPage).Methods(http.MethodGet)

		r.HandleFunc("/pb", pbStaticPage).Methods(http.MethodGet)
		r.HandleFunc("/api/v1/pb", getPB).Methods(http.MethodGet)
		r.HandleFunc("/api/v1/pb", setPB).Methods(http.MethodPost)

		r.HandleFunc("/api/v1/surl", listShortenURL).Methods(http.MethodGet)
		r.HandleFunc("/api/v1/surl", setShortenURL).Methods(http.MethodPost)
		r.HandleFunc("/api/v1/surl/{shorten}", deleteShortenURL).Methods(http.MethodDelete)
		r.HandleFunc("/{shorten}", getShortenURL)
	}

	// Configure CORS with more restrictive settings
	corsHandler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"}, // In production, replace with specific origins
		AllowedMethods:   []string{"GET", "POST", "DELETE"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		ExposedHeaders:   []string{},
		MaxAge:           300,
		AllowCredentials: false,
	})

	handler := corsHandler.Handler(r)

	// Configure HTTP server with timeouts
	server := &http.Server{
		Addr:         httpPort,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("http service on %s\n", httpPort)

	if err := server.ListenAndServe(); err != nil {
		log.Printf("http.ListenAndServe failed: %+v", err)
	}
}
