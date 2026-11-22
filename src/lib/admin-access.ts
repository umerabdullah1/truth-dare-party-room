const configuredAdminEmail = "u96598999@gmail.com";

export function isConfiguredAdmin(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === configuredAdminEmail;
}