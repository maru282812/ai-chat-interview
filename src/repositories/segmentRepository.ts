import { supabase } from "../config/supabase";
import { requireData, throwIfError } from "./baseRepository";

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  conditions: { operator: "AND" | "OR"; conditions: SegmentCondition[] };
  estimated_count: number | null;
  last_evaluated_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentCondition {
  field: string;
  op: "eq" | "neq" | "gte" | "lte" | "in" | "contains";
  value: unknown;
  attr_value?: unknown;
}

export interface SegmentCreateInput {
  name: string;
  description?: string | null;
  conditions: Segment["conditions"];
  created_by?: string | null;
}

export const segmentRepository = {
  async list(): Promise<Segment[]> {
    const { data, error } = await supabase
      .from("segments")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Segment[];
  },

  async getById(id: string): Promise<Segment> {
    const { data, error } = await supabase
      .from("segments")
      .select("*")
      .eq("id", id)
      .single();
    throwIfError(error);
    return requireData(data as Segment | null, `Segment not found: ${id}`);
  },

  async create(input: SegmentCreateInput): Promise<Segment> {
    const { data, error } = await supabase
      .from("segments")
      .insert({ ...input, conditions: input.conditions })
      .select("*")
      .single();
    throwIfError(error);
    return data as Segment;
  },

  async update(id: string, input: Partial<SegmentCreateInput>): Promise<Segment> {
    const { data, error } = await supabase
      .from("segments")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Segment;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("segments").delete().eq("id", id);
    throwIfError(error);
  },

  async updateEstimatedCount(id: string, count: number): Promise<void> {
    const { error } = await supabase
      .from("segments")
      .update({ estimated_count: count, last_evaluated_at: new Date().toISOString() })
      .eq("id", id);
    throwIfError(error);
  }
};
