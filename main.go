package main

import (
	"io"
	"log"
	"net/http"
	"os"

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
			io.WriteString(w, "Hello world!!")
		})

		r.HandleFunc("/pb", pbStaticPage).Methods(http.MethodGet)
		r.HandleFunc("/api/v1/pb", pbHandler)

		r.HandleFunc("/api/v1/surl", listShortenURL).Methods(http.MethodGet)
		r.HandleFunc("/api/v1/surl", setShortenURL).Methods(http.MethodPost)
		r.HandleFunc("/api/v1/surl/{shorten}", deleteShortenURL).Methods(http.MethodDelete)
		r.HandleFunc("/{shorten}", getShortenURL)
	}

	// cors.Default() setup the middleware with default options being
	// all origins accepted with simple methods (GET, POST). See
	// documentation below for more options.
	handler := cors.Default().Handler(r)
	log.Printf("http service on %s\n", httpPort)

	err := http.ListenAndServe(httpPort, handler)
	if err != nil {
		log.Printf("http.ListenAndServe failed: %+v", err)
	}
}
