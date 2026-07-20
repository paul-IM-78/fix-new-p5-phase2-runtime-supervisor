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

