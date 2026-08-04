/// <reference types="vitepress/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<
    Record<string, never>,
    Record<string, never>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SFC runtime data (untyped)
    any
  >;
  export default component;
}
