import { router, type Href } from 'expo-router';

/**
 * Go to one of the main sections (Classes, Chats, Profile) from anywhere. Screens opened on top
 * (a class, a chat, a question...) are closed first, so the main screens aren't stacked twice.
 */
export function goToSection(href: '/' | '/chats' | '/profile') {
  if (router.canDismiss()) router.dismissTo(href as Href);
  else router.navigate(href as Href);
}
