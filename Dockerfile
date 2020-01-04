# Build code
FROM golang:1.13-alpine as builder
ENV GO111MODULE=on

WORKDIR /app
COPY . .
RUN apk add --update git ca-certificates \
    && go mod download 
RUN go build -o app .


# pull the binary file and service work really in the layer
FROM alpine:latest

WORKDIR /srv/application
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/app /srv/application/toolbox
COPY --from=builder /app/public /srv/application/public
# COPY --from=builder /app/configs/config-build.yml /srv/express/configs/config.yml

ENTRYPOINT ["./toolbox"]

