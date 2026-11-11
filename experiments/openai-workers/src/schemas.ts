import { z } from "zod";

export const FIXTURE_ID = "desk-lamp";
export const FIXTURE_CODE = "NS-FIXTURE-417";

export const fixtureInputSchema = z.object({
  fixtureId: z.literal(FIXTURE_ID),
});

export const fixtureOutputSchema = z.object({
  code: z.literal(FIXTURE_CODE),
});

export const labelSchema = z.object({
  label: z.literal("sol-check"),
  count: z.literal(2),
});
