import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/colorCycle/document/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/colorCycle/document/legacyLayerBufferAccess",
                "@/lib/colorCycle/document/legacyTopLevelBuffers",
              ],
              message: "Legacy color-cycle buffer internals must be accessed through src/lib/colorCycle/document.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^(gradientIdBuffer|gradientDefIdBuffer|phaseBuffer|smoothPhaseBuffer|smoothFlagsBuffer)$/][object.name='colorCycleData']",
          message: "Deprecated color-cycle layer buffer mirrors must be read through src/lib/colorCycle/document helpers.",
        },
        {
          selector: "MemberExpression[property.name=/^(gradientIdBuffer|gradientDefIdBuffer|phaseBuffer|smoothPhaseBuffer|smoothFlagsBuffer)$/][object.property.name='colorCycleData']",
          message: "Deprecated color-cycle layer buffer mirrors must be read through src/lib/colorCycle/document helpers.",
        },
      ],
    },
  },
];

export default eslintConfig;
