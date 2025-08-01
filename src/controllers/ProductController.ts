import { Request, Response } from "express";
import Product from "../models/Product";
import multer from "multer";
import path from "path";
// List all products
export const index = async (req: Request, res: Response): Promise<Response> => {
  try {
    // Fetch all products where companyId matches the user's company
    const companyId = req.query.companyId || req.user.companyId; // Assuming user has companyId in their token
    if (!companyId) {
      return res.status(400).json({ error: "Company ID is required" });
    }
    const products = await Product.findAll({ where: { companyId } });
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
    console.log("try creating", req.body);
    const product = await Product.create({
      name: req.body.name,
      details: req.body.details,
      price: req.body.price,
      stock: req.body.stock,
      companyId: req.body.companyId,
      metadata: {file: req.file ? req.file.filename : null}, // store metadata if needed
    });
    return res.status(201).json(product);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error creating product" });
  }
};

// Update a product
export const update = async (req: Request, res: Response): Promise<Response> => {
 try {
    const id = req.params.id;
    const data: any = { ...req.body };
    const product = await Product.update({
      name: req.body.name,
      details: req.body.details,
      price: req.body.price,
      stock: req.body.stock,
      companyId: req.body.companyId,
      metadata: {file: req.file ? req.file.filename : null}, // store metadata if needed
    }, { where: { id } });
    return res.status(200).json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating product" });
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
// https://api-ronda.twimbox.com/products
// https://api-ronda.twimbox.com/campaigns/?searchParam=&pageNumber=1
// https://api-ronda.twimbox.com/products?searchParam=&pageNumber=1

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
