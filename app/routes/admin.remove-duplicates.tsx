import { Form, useActionData } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { removeDuplicateTracks } from "~/services/db.server";
import { jsonWithError, jsonWithSuccess } from "remix-toast";

export async function action() {
  try {
    const result = await removeDuplicateTracks();
    return jsonWithSuccess(
      { result },
      `Successfully merged ${result.mergedCount} duplicate tracks`
    );
  } catch (error) {
    return jsonWithError(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Failed to remove duplicates"
    );
  }
}

export default function RemoveDuplicates() {
  const actionData = useActionData<typeof action>();

  return (
    <div className="container py-8">
      <Card>
        <CardHeader>
          <CardTitle>Remove Duplicate Tracks</CardTitle>
          <CardDescription>
            This will find tracks that appear in multiple playlists and merge them into a single entry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post">
            <Button type="submit">Remove Duplicates</Button>
          </Form>
          
          {actionData && (
            <div className="mt-4 p-4 border rounded">
              <h3 className="font-medium">Result:</h3>
              <pre className="mt-2 bg-gray-100 p-2 rounded overflow-auto">
                {JSON.stringify(actionData, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 