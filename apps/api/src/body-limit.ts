export const MAX_BODY_BYTES = 65_536;
export const bodyLimit = (method: string, pathname: string): number =>
  method === "POST" && pathname === "/admin/contact-directory/import"
    ? 2_000_000
    : MAX_BODY_BYTES;
