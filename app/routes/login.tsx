import { json, redirect, ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { getDb } from "~/services/db.server";
import { sessionStorage } from "~/services/session.server";
import bcrypt from "bcrypt";



export async function loader({ request }: LoaderFunctionArgs) {
  // Check if user is already logged in
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  const userEmail = session.get("userEmail");

  if (userEmail) {
    // User is already logged in, redirect to dashboard
    return redirect("/dashboard");
  }

  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !email.includes("@")) {
    return json({ error: "Please enter a valid email address" });
  }

  if (!password || password.length < 4) {
    return json({ error: "Password must be at least 4 characters long" });
  }

  const db = await getDb();
  try {
    // Check if user exists
    const user = await db.get("SELECT * FROM user WHERE user_email = ?", [email]);


    // Login flow
    if (!user) {
      return json({ error: "Invalid email or password" });
    }

    // Verify password
    const isPasswordValid = user.password
      ? await bcrypt.compare(password, user.password)
      : false;

    if (!isPasswordValid) {
      return json({ error: "Invalid email or password" });
    }

    // Create session
    const session = await sessionStorage.getSession();
    session.set("userEmail", email);
    session.set("userId", user.id);

    return redirect("/dashboard", {
      headers: {
        "Set-Cookie": await sessionStorage.commitSession(session),
      },
    });

  } catch (error) {
    console.error("Error during login/registration:", error);
    return json({ error: "An error occurred. Please try again." });
  } finally {
    await db.close();
  }
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>
            Enter your credentials to access your playlists
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="your.email@example.com"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  required
                />
              </div>
              {actionData?.error && (
                <p className="text-sm text-red-500">{actionData.error}</p>
              )}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  name="action"
                  value="login"
                  className="flex-1"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Logging in..." : "Login"}
                </Button>

              </div>
            </div>
          </Form>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <div className="text-sm text-muted-foreground">
            After logging in, you can connect your Spotify and YouTube accounts
          </div>
          <div className="text-sm text-muted-foreground bg-muted p-2 rounded">
            <p className="font-medium">Test User:</p>
            <p>Email: test@test.ch</p>
            <p>Password: 1234</p>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
} 