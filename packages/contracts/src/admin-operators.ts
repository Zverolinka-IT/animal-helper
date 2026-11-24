import { z } from "zod";

export const operatorInvitationRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
});

export type OperatorInvitation = Readonly<{
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}>;

export const operatorManagementRequestSchema = z.strictObject({
  canManageOperators: z.boolean(),
  expectedCanManageOperators: z.boolean(),
});

export type OperatorAccount = Readonly<{
  id: string;
  email: string;
  canManageOperators: boolean;
}>;
