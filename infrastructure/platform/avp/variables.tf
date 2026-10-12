variable "naming_prefix" {
  description = "Resource naming prefix"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
