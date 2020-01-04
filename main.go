package main

import (
	"encoding/json"
	"io"
	"io/ioutil"
	"log"
	"net/http"

	"github.com/go-redis/redis"
)

var redisClient *redis.Client

func init() {
	redisClient = redis.NewClient(&redis.Options{
		Addr:     "localhost:6379",
		Password: "",
		DB:       0,
	})
}

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "Hello world!")
	})

	http.HandleFunc("/pb", func(w http.ResponseWriter, r *http.Request) {
		body, _ := ioutil.ReadFile("pb.html")
		io.WriteString(w, string(body))
	})
	http.HandleFunc("/api/v1/pb", pbHandler)

	log.Println("http service on :8000")
	http.ListenAndServe(":8000", nil)
}

func pbHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getPB(w, r)
	case http.MethodPost:
		setPB(w, r)
	}
}

type pbStruct struct {
	Text string `json:"text"`
}

func getPB(w http.ResponseWriter, r *http.Request) {
	result, err := redisClient.Get("pb").Result()
	if err != nil {
		log.Println(err)
	}

	pb := pbStruct{Text: result}
	pbBytes, err := json.Marshal(pb)
	if err != nil {
		log.Println(err)
	}

	io.WriteString(w, string(pbBytes))
}

func setPB(w http.ResponseWriter, r *http.Request) {
	decoder := json.NewDecoder(r.Body)

	var pb pbStruct
	err := decoder.Decode(&pb)
	if err != nil {
		log.Println(err)
	}

	err = redisClient.Set("pb", pb.Text, 0).Err()
	if err != nil {
		log.Println(err)
	}

	w.WriteHeader(http.StatusNoContent)
}
