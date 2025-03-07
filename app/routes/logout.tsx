import { redirect, type ActionFunctionArgs } from "@remix-run/node";
import { sessionStorage } from "~/services/session.server";

export async function loader() {
  // Redirect to login page if someone tries to access this route directly
  return redirect("/login");
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  
  // Destroy the session
  return redirect("/login", {
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session),
    },
  });
}
