import { View, type ViewProps } from "react-native";
import { cardClasses, type CardTone } from "./card-styles";

export interface CardProps extends ViewProps {
  /** low = cards and list rows, elevated = modals and track lists, selected = the chosen one. */
  tone?: CardTone;
}

export function Card({ tone = "low", className, ...rest }: CardProps) {
  const base = cardClasses(tone);
  return <View className={className ? `${base} ${className}` : base} {...rest} />;
}
