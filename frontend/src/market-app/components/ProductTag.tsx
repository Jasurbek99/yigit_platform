import type { ReactElement } from 'react';
import type { IMarketProduct } from '../types';

/** Tomato is the default: no product set reads as tomato and shows no tag. */
export function isOtherProduct(product: IMarketProduct | null): product is IMarketProduct {
  return product !== null && product.code !== 'tomato';
}

interface IProductTagProps {
  product: IMarketProduct | null;
}

/** Green pill with the product name, only when the truck is not tomatoes (artifact `.product.is-other`). */
export function ProductTag({ product }: IProductTagProps): ReactElement | null {
  if (!isOtherProduct(product)) return null;
  return <span className="mk-product">{product.name_ru}</span>;
}
