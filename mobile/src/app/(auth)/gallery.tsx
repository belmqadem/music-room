import { Redirect } from "expo-router";
import ComponentGallery from "@/dev/ComponentGallery";

// The component gallery is a design tool: development builds only. A release build goes home.
export default function GalleryRoute() {
  return __DEV__ ? <ComponentGallery /> : <Redirect href="/" />;
}
