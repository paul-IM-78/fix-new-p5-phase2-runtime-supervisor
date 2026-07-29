export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          account_status: string
          created_at: string
          display_name: string | null
          id: string
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
          version: number
        }
        Insert: {
          account_status?: string
          created_at?: string
          display_name?: string | null
          id: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          account_status?: string
          created_at?: string
          display_name?: string | null
          id?: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      project_token_assignments: {
        Row: {
          asset_id: string
          assigned_at: string
          created_at: string
          id: string
          project_id: string
          retired_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          asset_id: string
          assigned_at?: string
          created_at?: string
          id?: string
          project_id: string
          retired_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          asset_id?: string
          assigned_at?: string
          created_at?: string
          id?: string
          project_id?: string
          retired_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_token_assignments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "supported_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_token_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          display_name: string
          id: string
          project_code: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          project_code: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          project_code?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      supported_assets: {
        Row: {
          asset_code: string
          asset_type: string
          created_at: string
          decimals: number
          display_name: string
          id: string
          mint_address: string | null
          network: string
          status: string
          symbol: string
          updated_at: string
          version: number
        }
        Insert: {
          asset_code: string
          asset_type: string
          created_at?: string
          decimals: number
          display_name: string
          id?: string
          mint_address?: string | null
          network?: string
          status?: string
          symbol: string
          updated_at?: string
          version?: number
        }
        Update: {
          asset_code?: string
          asset_type?: string
          created_at?: string
          decimals?: number
          display_name?: string
          id?: string
          mint_address?: string | null
          network?: string
          status?: string
          symbol?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          grant_reason: string | null
          granted_at: string
          granted_by: string | null
          id: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          role: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          grant_reason?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          role: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          grant_reason?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          role?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_accounts: {
        Row: {
          closed_at: string | null
          created_at: string
          custody_model: string
          id: string
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          custody_model?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          custody_model?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "wallet_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_cancel_user_funding_request: {
        Args: {
          p_command_id: string
          p_deposit_request_id: string
          p_reason: string
          p_request_expected_version: number
        }
        Returns: {
          asset_id: string
          command_id: string
          deposit_request_id: string
          event_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
        }[]
      }
      admin_cancel_user_payout_request: {
        Args: {
          p_command_id: string
          p_reason: string
          p_request_expected_version: number
          p_withdrawal_request_id: string
        }
        Returns: {
          asset_id: string
          command_id: string
          event_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
          withdrawal_request_id: string
        }[]
      }
      admin_open_review_case: {
        Args: {
          p_idempotency_key: string
          p_reason_code: string
          p_reconciliation_item_id: string
        }
        Returns: {
          created: boolean
          event_id: string
          review_case_id: string
          status: string
          version: number
        }[]
      }
      admin_transition_review_case: {
        Args: {
          p_expected_version: number
          p_idempotency_key: string
          p_reason_code: string
          p_review_case_id: string
          p_target_status: string
        }
        Returns: {
          created: boolean
          event_id: string
          review_case_id: string
          status: string
          version: number
        }[]
      }
      approve_user_payout_request: {
        Args: {
          p_command_id: string
          p_reason: string
          p_request_expected_version: number
          p_withdrawal_request_id: string
        }
        Returns: {
          asset_id: string
          command_id: string
          event_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
          withdrawal_request_id: string
        }[]
      }
      assign_project_token: {
        Args: {
          p_asset_id: string
          p_command_id: string
          p_project_id: string
          p_reason: string
        }
        Returns: {
          asset_id: string
          assignment_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
        }[]
      }
      cancel_current_user_funding_request: {
        Args: {
          p_command_id: string
          p_deposit_request_id: string
          p_request_expected_version: number
        }
        Returns: {
          asset_id: string
          command_id: string
          deposit_request_id: string
          event_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
        }[]
      }
      cancel_current_user_payout_request: {
        Args: {
          p_command_id: string
          p_reason: string
          p_request_expected_version: number
          p_withdrawal_request_id: string
        }
        Returns: {
          asset_id: string
          command_id: string
          event_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
          withdrawal_request_id: string
        }[]
      }
      confirm_user_funding_request: {
        Args: {
          p_command_id: string
          p_deposit_request_id: string
          p_reason: string
          p_request_expected_version: number
        }
        Returns: {
          asset_id: string
          command_id: string
          deposit_request_id: string
          event_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
        }[]
      }
      create_project: {
        Args: {
          p_command_id: string
          p_description: string
          p_display_name: string
          p_project_code: string
          p_reason: string
        }
        Returns: {
          asset_id: string
          assignment_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
        }[]
      }
      create_staking_product: {
        Args: {
          p_asset_id: string
          p_command_id: string
          p_description: string
          p_display_name: string
          p_enrollment_ends_at: string
          p_enrollment_starts_at: string
          p_lock_duration_days: number
          p_max_stake_units: string
          p_min_stake_units: string
          p_product_code: string
          p_project_id: string
          p_reason: string
          p_term_reward_rate_ppm: number
        }
        Returns: {
          asset_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
          staking_product_id: string
        }[]
      }
      create_supported_asset: {
        Args: {
          p_asset_code: string
          p_asset_type: string
          p_command_id: string
          p_decimals: number
          p_display_name: string
          p_mint_address: string
          p_reason: string
          p_symbol: string
        }
        Returns: {
          asset_id: string
          assignment_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
        }[]
      }
      create_user_funding_request: {
        Args: {
          p_asset_expected_version: number
          p_asset_id: string
          p_command_id: string
          p_units: string
          p_wallet_account_id: string
          p_wallet_expected_version: number
        }
        Returns: {
          asset_id: string
          command_id: string
          deposit_request_id: string
          event_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
        }[]
      }
      create_user_payout_request: {
        Args: {
          p_asset_expected_version: number
          p_asset_id: string
          p_command_id: string
          p_units: string
          p_wallet_account_id: string
          p_wallet_expected_version: number
        }
        Returns: {
          asset_id: string
          command_id: string
          event_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
          withdrawal_request_id: string
        }[]
      }
      create_user_staking_position: {
        Args: {
          p_command_id: string
          p_position_id: string
          p_principal_units: string
          p_product_expected_version: number
          p_staking_product_id: string
          p_wallet_account_id: string
          p_wallet_expected_version: number
        }
        Returns: {
          asset_id: string
          command_id: string
          entity_version: number
          event_id: string
          lock_journal_id: string
          locked_at: string
          matures_at: string
          principal_units: string
          project_id: string
          replayed: boolean
          result_code: string
          resulting_status: string
          staking_position_id: string
          staking_product_id: string
          wallet_account_id: string
        }[]
      }
      fail_user_payout_execution: {
        Args: {
          p_attempt_expected_version: number
          p_command_id: string
          p_execution_attempt_id: string
          p_failure_code: string
          p_failure_reason: string
          p_request_expected_version: number
          p_withdrawal_request_id: string
        }
        Returns: {
          asset_id: string
          attempt_version: number
          command_id: string
          event_id: string
          execution_attempt_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
          withdrawal_request_id: string
        }[]
      }
      grant_admin_role: {
        Args: {
          p_command_id: string
          p_reason: string
          p_target_user_id: string
        }
        Returns: {
          command_id: string
          event_id: string
          occurred_at: string
          replayed: boolean
          result_code: string
          role_record_id: string
          target_user_id: string
        }[]
      }
      is_current_user_admin: { Args: never; Returns: boolean }
      is_current_user_admin_aal2: { Args: never; Returns: boolean }
      list_admin_custody_account_bindings: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          account_role: string
          approved_at: string
          asset_code: string
          asset_id: string
          asset_status: string
          asset_symbol: string
          asset_type: string
          binding_key: string
          created_at: string
          custody_account_binding_id: string
          custody_provider_id: string
          display_label: string
          provider_code: string
          retired_at: string
          status: string
          suspended_at: string
          updated_at: string
          version: number
        }[]
      }
      list_admin_custody_providers: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          approved_at: string
          created_at: string
          custody_provider_id: string
          display_name: string
          provider_code: string
          provider_type: string
          retired_at: string
          status: string
          supports_balance_observation: boolean
          supports_payout_submission: boolean
          supports_transfer_lookup: boolean
          supports_transfer_observation: boolean
          supports_webhook_ingestion: boolean
          suspended_at: string
          updated_at: string
          version: number
        }[]
      }
      list_admin_deposit_requests: {
        Args: { p_before_deposit_request_id?: string; p_limit?: number }
        Returns: {
          asset_code: string
          asset_id: string
          canceled_at: string
          canceled_by: string
          cancellation_actor_type: string
          cancellation_journal_id: string
          confirmation_journal_id: string
          confirmed_at: string
          confirmed_by: string
          decimals: number
          deposit_request_id: string
          profile_status: string
          request_journal_id: string
          requested_at: string
          requested_units: string
          status: string
          symbol: string
          target_user_id: string
          version: number
          wallet_account_id: string
          wallet_status: string
        }[]
      }
      list_admin_ledger_journals: {
        Args: { p_before_journal_id?: string; p_limit?: number }
        Returns: {
          asset_code: string
          asset_id: string
          command_id: string
          credit_total_units: string
          debit_total_units: string
          entry_count: number
          initiator_type: string
          initiator_user_id: string
          journal_id: string
          journal_type: string
          posted_at: string
          reason: string
          reference_id: string
          reference_type: string
          reversal_journal_id: string
          reversed: boolean
          symbol: string
        }[]
      }
      list_admin_project_token_assignments: {
        Args: { p_include_retired?: boolean; p_limit?: number }
        Returns: {
          asset_code: string
          asset_id: string
          asset_symbol: string
          assigned_at: string
          assignment_id: string
          project_code: string
          project_display_name: string
          project_id: string
          retired_at: string
          version: number
        }[]
      }
      list_admin_projects: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          description: string
          display_name: string
          project_code: string
          project_id: string
          status: string
          updated_at: string
          version: number
        }[]
      }
      list_admin_role_audit_events: {
        Args: { p_before_event_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_user_id: string
          command_id: string
          event_id: string
          occurred_at: string
          outcome: string
          previously_active: boolean
          reason: string
          resulting_active: boolean
          role: string
          role_record_id: string
          role_version: number
          target_account_status: string
          target_user_id: string
        }[]
      }
      list_admin_staking_positions: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          asset_code: string
          asset_decimals: number
          asset_id: string
          asset_symbol: string
          calculated_reward_units: string
          lock_duration_days_snapshot: number
          locked_at: string
          matures_at: string
          maturity_state: string
          position_version: number
          principal_units: string
          product_code: string
          product_version_snapshot: number
          profile_status: string
          project_code: string
          project_id: string
          reward_actor_type: string
          reward_journal_id: string
          reward_rounding_mode_snapshot: string
          reward_settled_at: string
          reward_settlement_id: string
          reward_state: string
          settled_by: string
          settlement_outcome: string
          staking_position_id: string
          staking_product_id: string
          status: string
          term_reward_rate_ppm_snapshot: number
          unlock_actor_type: string
          unlocked_at: string
          unlocked_by: string
          user_id: string
          wallet_account_id: string
          wallet_status: string
        }[]
      }
      list_admin_staking_products: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          activated_at: string
          archived_at: string
          asset_code: string
          asset_decimals: number
          asset_id: string
          asset_network: string
          asset_status: string
          asset_symbol: string
          asset_type: string
          created_at: string
          current_project_token: boolean
          description: string
          display_name: string
          enrollment_ends_at: string
          enrollment_starts_at: string
          enrollment_state: string
          lock_duration_days: number
          max_stake_units: string
          min_stake_units: string
          product_code: string
          project_code: string
          project_display_name: string
          project_id: string
          project_status: string
          reward_rounding_mode: string
          staking_product_id: string
          status: string
          suspended_at: string
          term_reward_rate_ppm: number
          updated_at: string
          version: number
        }[]
      }
      list_admin_supported_assets: {
        Args: { p_limit?: number }
        Returns: {
          asset_code: string
          asset_id: string
          asset_type: string
          created_at: string
          decimals: number
          display_name: string
          mint_address: string
          network: string
          status: string
          symbol: string
          updated_at: string
          version: number
        }[]
      }
      list_admin_wallet_accounts: {
        Args: { p_limit?: number }
        Returns: {
          closed_at: string
          created_at: string
          custody_model: string
          profile_account_status: string
          updated_at: string
          user_id: string
          version: number
          wallet_account_id: string
          wallet_status: string
        }[]
      }
      list_admin_wallet_asset_ledger_balances: {
        Args: { p_limit?: number }
        Returns: {
          asset_code: string
          asset_id: string
          available_units: string
          decimals: number
          locked_units: string
          pending_deposit_units: string
          pending_withdrawal_units: string
          profile_status: string
          symbol: string
          target_user_id: string
          total_liability_units: string
          wallet_account_id: string
          wallet_status: string
        }[]
      }
      list_admin_withdrawal_requests: {
        Args: { p_before_withdrawal_request_id?: string; p_limit?: number }
        Returns: {
          approval_journal_id: string
          approved_at: string
          approved_by: string
          asset_code: string
          asset_id: string
          canceled_at: string
          canceled_by: string
          canceled_from_status: string
          cancellation_actor_type: string
          cancellation_journal_id: string
          decimals: number
          execution_completed_at: string
          latest_execution_attempt_id: string
          latest_execution_attempt_no: number
          latest_execution_attempt_version: number
          latest_execution_status: string
          profile_status: string
          requested_at: string
          requested_units: string
          reservation_journal_id: string
          reserved_at: string
          reserved_by: string
          settlement_journal_id: string
          status: string
          symbol: string
          target_user_id: string
          version: number
          wallet_account_id: string
          wallet_status: string
          withdrawal_request_id: string
        }[]
      }
      list_current_staking_products: {
        Args: { p_limit?: number }
        Returns: {
          asset_code: string
          asset_decimals: number
          asset_id: string
          asset_symbol: string
          description: string
          display_name: string
          enrollment_ends_at: string
          enrollment_starts_at: string
          enrollment_state: string
          lock_duration_days: number
          max_stake_units: string
          min_stake_units: string
          product_code: string
          product_version: number
          project_code: string
          project_display_name: string
          project_id: string
          reward_rounding_mode: string
          staking_product_id: string
          term_reward_rate_ppm: number
        }[]
      }
      list_current_user_deposit_requests: {
        Args: { p_limit?: number }
        Returns: {
          asset_code: string
          asset_id: string
          canceled_at: string
          cancellation_actor_type: string
          cancellation_journal_id: string
          confirmation_journal_id: string
          confirmed_at: string
          decimals: number
          deposit_request_id: string
          request_journal_id: string
          requested_at: string
          requested_units: string
          status: string
          symbol: string
          version: number
          wallet_account_id: string
        }[]
      }
      list_current_user_ledger_balances: {
        Args: never
        Returns: {
          asset_code: string
          asset_id: string
          available_units: string
          decimals: number
          locked_units: string
          pending_deposit_units: string
          pending_withdrawal_units: string
          symbol: string
          total_liability_units: string
        }[]
      }
      list_current_user_staking_positions: {
        Args: { p_limit?: number }
        Returns: {
          asset_code: string
          asset_decimals: number
          asset_id: string
          asset_symbol: string
          calculated_reward_units: string
          lock_duration_days_snapshot: number
          locked_at: string
          matures_at: string
          maturity_state: string
          position_version: number
          principal_units: string
          product_code: string
          product_display_name: string
          product_version_snapshot: number
          project_code: string
          project_display_name: string
          project_id: string
          reward_actor_type: string
          reward_rounding_mode_snapshot: string
          reward_settled_at: string
          reward_state: string
          staking_position_id: string
          staking_product_id: string
          status: string
          term_reward_rate_ppm_snapshot: number
          unlock_actor_type: string
          unlocked_at: string
        }[]
      }
      list_current_user_withdrawal_requests: {
        Args: { p_limit?: number }
        Returns: {
          approval_journal_id: string
          approved_at: string
          asset_code: string
          asset_id: string
          canceled_at: string
          canceled_from_status: string
          cancellation_actor_type: string
          cancellation_journal_id: string
          decimals: number
          execution_completed_at: string
          latest_execution_attempt_no: number
          latest_execution_status: string
          requested_at: string
          requested_units: string
          reservation_journal_id: string
          reserved_at: string
          settlement_journal_id: string
          status: string
          symbol: string
          version: number
          wallet_account_id: string
          withdrawal_request_id: string
        }[]
      }
      list_custody_config_audit_events: {
        Args: { p_before_event_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_user_id: string
          asset_id: string
          command_id: string
          custody_account_binding_id: string
          custody_provider_id: string
          entity_type: string
          entity_version: number
          event_id: string
          occurred_at: string
          outcome: string
          previous_status: string
          reason: string
          resulting_status: string
        }[]
      }
      list_deposit_command_audit_events: {
        Args: { p_before_event_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_type: string
          actor_user_id: string
          asset_id: string
          command_id: string
          deposit_request_id: string
          event_id: string
          occurred_at: string
          outcome: string
          previous_status: string
          reason: string
          resulting_journal_id: string
          resulting_status: string
          target_user_id: string
          units_text: string
          wallet_account_id: string
        }[]
      }
      list_domain_admin_audit_events: {
        Args: { p_before_event_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_user_id: string
          after_state: Json
          asset_id: string
          assignment_id: string
          before_state: Json
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          outcome: string
          project_id: string
          reason: string
        }[]
      }
      list_financial_admin_audit_events: {
        Args: { p_before_event_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_user_id: string
          asset_id: string
          command_id: string
          event_id: string
          occurred_at: string
          original_journal_id: string
          outcome: string
          reason: string
          resulting_journal_id: string
          target_user_id: string
          units_text: string
          wallet_account_id: string
        }[]
      }
      list_staking_position_command_audit_events: {
        Args: { p_before_event_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_type: string
          actor_user_id: string
          asset_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          outcome: string
          previous_status: string
          principal_units: string
          project_id: string
          reason: string
          resulting_journal_id: string
          resulting_status: string
          staking_position_id: string
          staking_product_id: string
          wallet_account_id: string
        }[]
      }
      list_staking_product_admin_audit_events: {
        Args: { p_before_event_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_user_id: string
          asset_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          outcome: string
          previous_status: string
          project_id: string
          reason: string
          resulting_status: string
          staking_product_id: string
        }[]
      }
      list_staking_reward_command_audit_events: {
        Args: { p_before_event_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_type: string
          actor_user_id: string
          asset_id: string
          command_id: string
          event_id: string
          occurred_at: string
          outcome: string
          project_id: string
          resulting_journal_id: string
          reward_settlement_id: string
          reward_units: string
          settlement_outcome: string
          staking_position_id: string
          staking_product_id: string
          target_user_id: string
          wallet_account_id: string
        }[]
      }
      list_wallet_account_admin_audit_events: {
        Args: { p_before_event_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_user_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          outcome: string
          previous_status: string
          reason: string
          resulting_status: string
          target_profile_status: string
          target_user_id: string
          wallet_account_id: string
        }[]
      }
      list_withdrawal_command_audit_events: {
        Args: { p_before_event_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_type: string
          actor_user_id: string
          asset_id: string
          command_id: string
          event_id: string
          execution_attempt_id: string
          occurred_at: string
          outcome: string
          previous_status: string
          reason: string
          resulting_journal_id: string
          resulting_status: string
          target_user_id: string
          units_text: string
          wallet_account_id: string
          withdrawal_request_id: string
        }[]
      }
      list_withdrawal_execution_attempts: {
        Args: { p_before_execution_attempt_id?: string; p_limit?: number }
        Returns: {
          attempt_no: number
          completed_at: string
          execution_attempt_id: string
          failure_code: string
          failure_reason: string
          settlement_journal_id: string
          started_at: string
          status: string
          version: number
          withdrawal_request_id: string
        }[]
      }
      post_opening_balance: {
        Args: {
          p_asset_expected_version: number
          p_asset_id: string
          p_command_id: string
          p_reason: string
          p_units: string
          p_wallet_account_id: string
          p_wallet_expected_version: number
        }
        Returns: {
          asset_id: string
          command_id: string
          event_id: string
          journal_id: string
          posted_at: string
          replayed: boolean
          result_code: string
          units: string
          wallet_account_id: string
        }[]
      }
      reserve_user_payout_request: {
        Args: {
          p_command_id: string
          p_reason: string
          p_request_expected_version: number
          p_withdrawal_request_id: string
        }
        Returns: {
          asset_id: string
          command_id: string
          event_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
          withdrawal_request_id: string
        }[]
      }
      retire_project_token: {
        Args: {
          p_assignment_id: string
          p_command_id: string
          p_expected_version: number
          p_reason: string
        }
        Returns: {
          asset_id: string
          assignment_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
        }[]
      }
      reverse_opening_balance: {
        Args: {
          p_command_id: string
          p_original_journal_id: string
          p_reason: string
        }
        Returns: {
          asset_id: string
          command_id: string
          event_id: string
          original_journal_id: string
          posted_at: string
          replayed: boolean
          result_code: string
          reversal_journal_id: string
          units: string
          wallet_account_id: string
        }[]
      }
      revoke_admin_role: {
        Args: {
          p_command_id: string
          p_reason: string
          p_target_user_id: string
        }
        Returns: {
          command_id: string
          event_id: string
          occurred_at: string
          replayed: boolean
          result_code: string
          role_record_id: string
          target_user_id: string
        }[]
      }
      settle_current_user_staking_reward: {
        Args: {
          p_command_id: string
          p_position_expected_version: number
          p_staking_position_id: string
          p_wallet_expected_version: number
        }
        Returns: {
          replayed: boolean
          result_code: string
          reward_settlement_id: string
          reward_state: string
          reward_units: string
          settled_at: string
          settlement_outcome: string
          staking_position_id: string
        }[]
      }
      settle_staking_reward_as_admin: {
        Args: {
          p_command_id: string
          p_position_expected_version: number
          p_reason: string
          p_staking_position_id: string
        }
        Returns: {
          replayed: boolean
          result_code: string
          reward_settlement_id: string
          reward_state: string
          reward_units: string
          settled_at: string
          settlement_outcome: string
          staking_position_id: string
        }[]
      }
      settle_user_payout_execution: {
        Args: {
          p_attempt_expected_version: number
          p_command_id: string
          p_execution_attempt_id: string
          p_reason: string
          p_request_expected_version: number
          p_withdrawal_request_id: string
        }
        Returns: {
          asset_id: string
          attempt_version: number
          command_id: string
          event_id: string
          execution_attempt_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
          withdrawal_request_id: string
        }[]
      }
      start_user_payout_execution: {
        Args: {
          p_command_id: string
          p_evidence_reference: string
          p_reason: string
          p_request_expected_version: number
          p_withdrawal_request_id: string
        }
        Returns: {
          asset_id: string
          attempt_version: number
          command_id: string
          event_id: string
          execution_attempt_id: string
          journal_id: string
          occurred_at: string
          replayed: boolean
          request_version: number
          result_code: string
          status: string
          units: string
          wallet_account_id: string
          withdrawal_request_id: string
        }[]
      }
      transition_custody_account_binding_status: {
        Args: {
          p_command_id: string
          p_custody_account_binding_id: string
          p_expected_version: number
          p_new_status: string
          p_reason: string
        }
        Returns: {
          asset_id: string
          command_id: string
          custody_account_binding_id: string
          custody_provider_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          replayed: boolean
          result_code: string
        }[]
      }
      transition_custody_provider_status: {
        Args: {
          p_command_id: string
          p_custody_provider_id: string
          p_expected_version: number
          p_new_status: string
          p_reason: string
        }
        Returns: {
          asset_id: string
          command_id: string
          custody_account_binding_id: string
          custody_provider_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          replayed: boolean
          result_code: string
        }[]
      }
      transition_project_status: {
        Args: {
          p_command_id: string
          p_expected_version: number
          p_new_status: string
          p_project_id: string
          p_reason: string
        }
        Returns: {
          asset_id: string
          assignment_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
        }[]
      }
      transition_staking_product_status: {
        Args: {
          p_command_id: string
          p_expected_version: number
          p_new_status: string
          p_reason: string
          p_staking_product_id: string
        }
        Returns: {
          asset_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
          staking_product_id: string
        }[]
      }
      transition_supported_asset_status: {
        Args: {
          p_asset_id: string
          p_command_id: string
          p_expected_version: number
          p_new_status: string
          p_reason: string
        }
        Returns: {
          asset_id: string
          assignment_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
        }[]
      }
      transition_wallet_account_status: {
        Args: {
          p_command_id: string
          p_expected_version: number
          p_new_status: string
          p_reason: string
          p_wallet_account_id: string
        }
        Returns: {
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          replayed: boolean
          result_code: string
          target_user_id: string
          wallet_account_id: string
        }[]
      }
      unlock_current_user_staking_position: {
        Args: {
          p_command_id: string
          p_position_expected_version: number
          p_staking_position_id: string
          p_wallet_expected_version: number
        }
        Returns: {
          maturity_state: string
          position_status: string
          position_version: number
          principal_units: string
          replayed: boolean
          result_code: string
          staking_position_id: string
          unlocked_at: string
        }[]
      }
      unlock_staking_position_as_admin: {
        Args: {
          p_command_id: string
          p_position_expected_version: number
          p_reason: string
          p_staking_position_id: string
        }
        Returns: {
          maturity_state: string
          position_status: string
          position_version: number
          principal_units: string
          replayed: boolean
          result_code: string
          staking_position_id: string
          unlocked_at: string
        }[]
      }
      update_project_details: {
        Args: {
          p_command_id: string
          p_description: string
          p_display_name: string
          p_expected_version: number
          p_project_id: string
          p_reason: string
        }
        Returns: {
          asset_id: string
          assignment_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
        }[]
      }
      update_staking_product_draft: {
        Args: {
          p_asset_id: string
          p_command_id: string
          p_description: string
          p_display_name: string
          p_enrollment_ends_at: string
          p_enrollment_starts_at: string
          p_expected_version: number
          p_lock_duration_days: number
          p_max_stake_units: string
          p_min_stake_units: string
          p_project_id: string
          p_reason: string
          p_staking_product_id: string
          p_term_reward_rate_ppm: number
        }
        Returns: {
          asset_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
          staking_product_id: string
        }[]
      }
      update_supported_asset_details: {
        Args: {
          p_asset_id: string
          p_command_id: string
          p_display_name: string
          p_expected_version: number
          p_reason: string
          p_symbol: string
        }
        Returns: {
          asset_id: string
          assignment_id: string
          command_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          project_id: string
          replayed: boolean
          result_code: string
        }[]
      }
      upsert_custody_account_binding_draft: {
        Args: {
          p_account_role?: string
          p_asset_id?: string
          p_binding_key?: string
          p_command_id?: string
          p_custody_account_binding_id?: string
          p_custody_provider_id?: string
          p_display_label?: string
          p_expected_version?: number
          p_reason?: string
        }
        Returns: {
          asset_id: string
          command_id: string
          custody_account_binding_id: string
          custody_provider_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          replayed: boolean
          result_code: string
        }[]
      }
      upsert_custody_provider_draft: {
        Args: {
          p_command_id?: string
          p_custody_provider_id?: string
          p_display_name?: string
          p_expected_version?: number
          p_provider_code?: string
          p_provider_type?: string
          p_reason?: string
          p_supports_balance_observation?: boolean
          p_supports_payout_submission?: boolean
          p_supports_transfer_lookup?: boolean
          p_supports_transfer_observation?: boolean
          p_supports_webhook_ingestion?: boolean
        }
        Returns: {
          asset_id: string
          command_id: string
          custody_account_binding_id: string
          custody_provider_id: string
          entity_version: number
          event_id: string
          occurred_at: string
          replayed: boolean
          result_code: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

