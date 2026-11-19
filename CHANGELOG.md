# asma-mfw-esmloader

## 0.25.0

### Minor Changes

-   ASMA-8742: Retired the `esm-overrides` override channel. The loader no longer reads the key, lists it as an active override, attributes a base to it, or clears it; a leftover key is ignored and left byte-identical. The single-spa `import-map-override:<app>` channel is unchanged. No host may adopt 0.25.0 in an environment until that environment runs a server whose head injection no longer applies `esm-overrides`.
