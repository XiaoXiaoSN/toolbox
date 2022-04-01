build-push-images:
	docker buildx build \
	--push \
	--platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 --tag xiaoxiaosn/toolbox:latest .

