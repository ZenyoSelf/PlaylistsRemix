import { useState, useEffect } from "react";
import { Form, useSubmit } from "@remix-run/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { Save } from "lucide-react";

interface FileFormatSelectorProps {
  userId: string;
  currentFormat?: string;
}

export default function FileFormatSelector({ userId, currentFormat = "flac" }: FileFormatSelectorProps) {
  const [selectedFormat, setSelectedFormat] = useState(currentFormat);
  const [isSaving, setIsSaving] = useState(false);
  const submit = useSubmit();

  useEffect(() => {
    if (currentFormat) {
      setSelectedFormat(currentFormat);
    }
  }, [currentFormat]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    
    submit(e.currentTarget, { method: "post", replace: true });
    
    // Reset saving state after a short delay
    setTimeout(() => {
      setIsSaving(false);
    }, 1000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audio Format Preferences</CardTitle>
        <CardDescription>
          Choose your preferred audio format for downloaded songs
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post" onSubmit={handleSubmit}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="_action" value="updateFileFormat" />
          
          <div className="flex flex-col space-y-4">
            <div className="space-y-2">
              <label htmlFor="fileFormat" className="text-sm font-medium">
                File Format
              </label>
              <Select
                name="fileFormat"
                value={selectedFormat}
                onValueChange={setSelectedFormat}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flac">FLAC (Lossless)</SelectItem>
                  <SelectItem value="mp3">MP3 (Compressed)</SelectItem>
                  <SelectItem value="wav">WAV (Uncompressed)</SelectItem>
                  <SelectItem value="aiff">AIFF (Uncompressed)</SelectItem>
                  <SelectItem value="m4a">M4A (AAC)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedFormat === "flac" && "High quality lossless audio format with good compression. Supports thumbnails & metadata."}
                {selectedFormat === "mp3" && "Smaller file size, good compatibility, some quality loss. Supports thumbnails & metadata."}
                {selectedFormat === "wav" && "Highest quality uncompressed audio, very large file size. No thumbnail support."}
                {selectedFormat === "aiff" && "High quality uncompressed audio with thumbnail & metadata support. Large file size."}
                {selectedFormat === "m4a" && "Good quality and compression, excellent for Apple devices. Supports thumbnails & metadata."}
              </p>
            </div>
            
            <Button type="submit" disabled={isSaving} className="w-full">
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? "Saving..." : "Save Preferences"}
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
} 