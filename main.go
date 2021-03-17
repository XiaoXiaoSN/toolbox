package main

import (
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"

	"github.com/go-redis/redis"
	"github.com/gorilla/mux"
)

var redisClient *redis.Client

func init() {
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

		r.HandleFunc("/pb", func(w http.ResponseWriter, r *http.Request) {
			body, _ := ioutil.ReadFile("public/pb.html")
			io.WriteString(w, string(body))
		})
		r.HandleFunc("/api/v1/pb", pbHandler)

		r.HandleFunc("/api/v1/surl", shortenURLHandler)
		r.HandleFunc("/{shorten}", shortenURLHandler)
	}

	http.Handle("/", r)
	log.Println("http service on :8000")
	http.ListenAndServe(":8000", nil)
}
