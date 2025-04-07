# Build stage
FROM --platform=$TARGETPLATFORM golang:1.21-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o app .

# Final stage
FROM --platform=$TARGETPLATFORM alpine:3

# Add non-root user
RUN addgroup -S toolbox && adduser -S toolbox -G toolbox

# Set working directory
WORKDIR /srv/application

# Copy necessary files from builder
COPY --from=builder --chown=toolbox:toolbox /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder --chown=toolbox:toolbox /app/app /srv/application/toolbox
COPY --from=builder --chown=toolbox:toolbox /app/public /srv/application/public

# Set proper permissions
RUN chmod 755 /srv/application/toolbox

# Switch to non-root user
USER toolbox

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8000/ || exit 1

# Expose port
EXPOSE 8000

# Set entrypoint
ENTRYPOINT ["/srv/application/toolbox"]
