# Thin wrapper around build.sh / build-in-container.sh. Run `make` for help.
#
# Builds natively when live-build is installed (Debian/Ubuntu), otherwise in
# a container. Force one with BUILDER=native or BUILDER=container.

ARGS ?=
BUILDER ?= $(if $(shell command -v lb 2>/dev/null),native,container)

ifeq ($(BUILDER),native)
BUILD = sudo --preserve-env=SLOPPINUX_BAKE_MODEL,APT_PROXY,SLOPPILER_SRC ./build.sh
else ifeq ($(BUILDER),container)
BUILD = ./build-in-container.sh
else
$(error BUILDER must be native or container, got '$(BUILDER)')
endif

.DEFAULT_GOAL := help
.PHONY: help iso iso-quick iso-refresh lint

help: ## Show this help
	@echo "Usage: make <target> [ARGS='build.sh flags'] [BUILDER=native|container]"
	@echo "Builder: $(BUILDER)"
	@echo
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

iso: ## Full ISO build
	$(BUILD) $(ARGS)

iso-quick: ## Reuse the cached chroot, only rebuild the image
	$(BUILD) --quick $(ARGS)

iso-refresh: ## Update the cached chroot, then rebuild the image
	$(BUILD) --refresh $(ARGS)

lint: ## Run scripts/lint.sh
	scripts/lint.sh
