import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
} from "@radix-ui/react-navigation-menu";
import { Link, Form } from "@remix-run/react";
import styles from "~/global.css?url";
import { LinksFunction } from "@remix-run/node";
import { Music, Link as LinkIcon, Download, UserCircle, LogOut, Plus } from "lucide-react";
import { DownloadManager } from "./DownloadManager";
import { Button } from "./ui/button";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

interface HeaderProps {
  userId: string | number;
}

export default function Header({ userId }: HeaderProps) {


  return (
    <div className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <header className="container flex h-16 items-center justify-between">
        {/* Logo and App Name */}
        <div className="flex items-center gap-2">
          <Link 
            to="/dashboard" 
            className="flex items-center gap-2 transition-colors hover:text-primary"
          >
            <Music className="h-6 w-6" />
            <span className="font-bold text-xl hidden md:inline-block">Zenyo&apos;s Playlix</span>
          </Link>
        </div>
        
        {/* Navigation */}
        <div className="flex items-center gap-4">
          <NavigationMenu>
            <NavigationMenuList className="hidden md:flex gap-1">
              <NavigationMenuItem>
                <Link
                  to="/library"
                  className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Library
                </Link>
              </NavigationMenuItem>
              
              <NavigationMenuItem>
                <Link
                  to="/new-additions"
                  className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New Additions
                </Link>
              </NavigationMenuItem>
              
              <NavigationMenuItem>
                <Link
                  to="/accountmanager"
                  className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50"
                >
                  <UserCircle className="mr-2 h-4 w-4" />
                  Account Manager
                </Link>
              </NavigationMenuItem>
              
              <NavigationMenuItem>
                <Link
                  to="/custom-url"
                  className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50"
                >
                  <LinkIcon className="mr-2 h-4 w-4" />
                  Custom URL
                </Link>
              </NavigationMenuItem>
              
              <NavigationMenuItem>
                <Form method="post" action="/logout">
                  <Button
                    type="submit"
                    variant="ghost"
                    className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </Button>
                </Form>
              </NavigationMenuItem>
            </NavigationMenuList>
            
            {/* Mobile Navigation */}
            <div className="md:hidden flex gap-2">
              <Button variant="ghost" size="icon" asChild>
                <Link to="/library">
                  <Download className="h-5 w-5" />
                </Link>
              </Button>
              <Button variant="ghost" size="icon" asChild>
                <Link to="/new-additions">
                  <Plus className="h-5 w-5" />
                </Link>
              </Button>
              <Button variant="ghost" size="icon" asChild>
                <Link to="/accountmanager">
                  <UserCircle className="h-5 w-5" />
                </Link>
              </Button>
              <Button variant="ghost" size="icon" asChild>
                <Link to="/custom-url">
                  <LinkIcon className="h-5 w-5" />
                </Link>
              </Button>
              <Form method="post" action="/logout">
                <Button variant="ghost" size="icon" type="submit">
                  <LogOut className="h-5 w-5" />
                </Button>
              </Form>
            </div>
          </NavigationMenu>

          {/* Download Manager Component */}
          <div className="border-l pl-4 ml-2">
            {userId && <DownloadManager userId={userId.toString()} />}
          </div>
        </div>
      </header>
    </div>
  );
}
