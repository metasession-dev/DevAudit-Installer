#!/usr/bin/env bash
# Context-aware helpers for simple GitHub-flavoured Markdown tables.

markdown_table_cell() {
  local file="$1"
  local key_value="$2"
  local target_header="$3"
  shift 3
  local required_headers=("$@")

  [ -f "$file" ] || return 1
  awk \
    -v key_value="$key_value" \
    -v target_header="$target_header" \
    -v required_headers="$(IFS=,; printf '%s' "${required_headers[*]}")" '
      function clean(value) {
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        gsub(/\001/, "\\|", value)
        return value
      }
      function split_row(line, cells,    protected) {
        protected=line
        gsub(/\\\|/, "\001", protected)
        return split(protected, cells, "|")
      }
      function header_matches(name, required,    options, count, i) {
        count=split(required, options, "/")
        for (i=1; i<=count; i++) {
          if (tolower(name) == tolower(options[i])) return 1
        }
        return 0
      }
      BEGIN {
        required_count=split(required_headers, required, ",")
        active=0
      }
      /^\|/ {
        count=split_row($0, cells)
        candidate_target=0
        candidate_key=0
        matched=0
        for (i=2; i<count; i++) {
          name=clean(cells[i])
          if (tolower(name) == tolower(target_header)) candidate_target=i
          for (r=1; r<=required_count; r++) {
            if (header_matches(name, required[r])) matched++
          }
          if (header_matches(name, required[1])) candidate_key=i
        }
        if (candidate_target && candidate_key && matched >= required_count) {
          active=1
          target_index=candidate_target
          key_index=candidate_key
          next
        }
        if (active && key_index && target_index && clean(cells[key_index]) == key_value) {
          print clean(cells[target_index])
          found=1
          exit 0
        }
        next
      }
      { active=0; key_index=0; target_index=0 }
      END { if (!found) exit 1 }
    ' "$file"
}

markdown_table_column_index_for_row() {
  local file="$1"
  local key_value="$2"
  local target_header="$3"
  shift 3
  local required_headers=("$@")

  [ -f "$file" ] || return 1
  awk \
    -v key_value="$key_value" \
    -v target_header="$target_header" \
    -v required_headers="$(IFS=,; printf '%s' "${required_headers[*]}")" '
      function clean(value) {
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        return value
      }
      function split_row(line, cells,    protected) {
        protected=line
        gsub(/\\\|/, "\001", protected)
        return split(protected, cells, "|")
      }
      function header_matches(name, required,    options, count, i) {
        count=split(required, options, "/")
        for (i=1; i<=count; i++) {
          if (tolower(name) == tolower(options[i])) return 1
        }
        return 0
      }
      BEGIN { required_count=split(required_headers, required, ","); active=0 }
      /^\|/ {
        count=split_row($0, cells)
        candidate_target=0
        candidate_key=0
        matched=0
        for (i=2; i<count; i++) {
          name=clean(cells[i])
          if (tolower(name) == tolower(target_header)) candidate_target=i
          for (r=1; r<=required_count; r++) {
            if (header_matches(name, required[r])) matched++
          }
          if (header_matches(name, required[1])) candidate_key=i
        }
        if (candidate_target && candidate_key && matched >= required_count) {
          active=1
          target_index=candidate_target
          key_index=candidate_key
          next
        }
        if (active && clean(cells[key_index]) == key_value) {
          print target_index
          found=1
          exit 0
        }
        next
      }
      { active=0 }
      END { if (!found) exit 1 }
    ' "$file"
}
