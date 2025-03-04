import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
} from "@radix-ui/react-navigation-menu";
import { Link } from "@remix-run/react";
import styles from "~/global.css?url";
import { LinksFunction } from "@remix-run/node";
import { HomeIcon } from "lucide-react";
import { DownloadManager } from "./DownloadManager";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export default function Header() {
  return (
    <header className="flex items-center justify-between px-4 py-2 md:py-4">
      <div className="flex items-center space-x-4">
        <Link className="flex items-center space-x-2" to="/">
          {<HomeIcon className="h-6 w-6" />}
          <span className="text-lg prose">ZenyoPlaylists</span>
        </Link>
      </div>
      
      <div className="flex items-center gap-4">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link
                  className="flex h-full w-full select-none flex-col justify-end rounded-md bg-gradient-to-b from-muted/50 to-muted p-2 no-underline outline-none focus:shadow-md"
                  to={"/updates"}
                >
                  DL Manager
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <DownloadManager userId="arnaud" />
      </div>
    </header>
  );
}
