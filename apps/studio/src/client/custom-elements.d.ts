import type * as React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "amphibian-slot": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        "data-salamanda-slot"?: string;
        "data-salamanda-mounted"?: string;
      };
    }
  }
}
