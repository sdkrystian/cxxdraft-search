.PHONY: all html post-build assets inject section-index pagefind clean serve deps

DIST := dist
GEN_DIR := vendor/cxxdraft-htmlgen
DRAFT_DIR := ../draft

all: html post-build

deps:
	cd $(GEN_DIR) && stack setup && stack build
	printf '{\n  "type": "commonjs",\n  "overrides": { "yargs": "12.0.5" }\n}\n' > $(GEN_DIR)/package.json
	cd $(GEN_DIR) && npm install mathjax-node mathjax-node-cli split
	npm install

html:
	rm -rf $(GEN_DIR)/14882
	cd $(GEN_DIR) && PATH="$$PWD/node_modules/.bin:$$PATH" stack exec cxxdraft-htmlgen -- $(DRAFT_DIR) InSubdir
	rm -rf $(DIST)
	mkdir -p $(DIST)
	cp -a $(GEN_DIR)/14882/. $(DIST)/

post-build: assets inject section-index pagefind

assets:
	cp web/search.css web/search.js $(DIST)/

inject:
	node tools/inject.mjs $(DIST)

section-index:
	node tools/section-index.mjs $(DIST)

pagefind:
	npx -y pagefind --site $(DIST)

serve:
	npx -y serve $(DIST)

clean:
	rm -rf $(DIST) $(GEN_DIR)/14882
