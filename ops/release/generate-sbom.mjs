#!/usr/bin/env node

process.stderr.write('generate-sbom.mjs is disabled: source inputs are not an image SBOM. Use generate-build-input-inventory.mjs for reproducible input evidence; G4 still requires an externally generated booking.image-sbom/v1 document.\n');
process.exitCode = 10;
