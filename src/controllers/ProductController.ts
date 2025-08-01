import { Request, Response } from "express";
import Product from "../models/Product";

// List all products
export const index = async (req: Request, res: Response): Promise<Response> => {
  try {
    const products = await Product.findAll();
    return res.status(200).json(products);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching products" });
  }
};

// Show product by ID
export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  try {
    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    return res.status(200).json(product);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching product" });
  }
};

// Create a new product
export const store = async (req: Request, res: Response): Promise<Response> => {
  try {
    const product = await Product.create(req.body);
    return res.status(201).json(product);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error creating product" });
  }
};

// Update a product
export const update = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  try {
    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    await product.update(req.body);
    return res.status(200).json(product);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error updating product" });
  }
};

// Delete a product
export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  try {
    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    await product.destroy();
    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error deleting product" });
  }
};

// List all products for a company
export const listByCompany = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.params;
  try {
    const products = await Product.findAll({
      where: { companyId: companyId }
    });
    return res.status(200).json(products);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching company products" });
  }
};
