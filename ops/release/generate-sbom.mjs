#!/usr/bin/env node

process.stderr.write('generate-sbom.mjs is disabled: source inputs are not an image SBOM. Use generate-build-input-inventory.mjs for source evidence and generate-image-sbom.mjs for a real booking.image-sbom/v2 image scan.\n');
process.exitCode = 10;
